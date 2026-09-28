import { browser } from "#imports";
import {
	PROMPT_ID,
	TRANSLATION_ACTIVITY_EVENT,
	WEB_ADAPTATION_MESSAGE,
} from "~/utils/constants";
import { autoStripMarkdown } from "~/utils/json-autocomplete";
import { getMarkdownFromSection } from "~/utils/markdown";
import { getPageContext } from "~/utils/page-context";
import { DEFAULT_DOM_LISTENER } from "~/utils/parser";
import { waitRpc } from "~/utils/rpc/wxt-def";
import type { SettingsSchema } from "~/utils/settings/def";
import { getSettings, listenSettings } from "~/utils/settings/helper";
import {
	findServiceForModelRef,
	resolveLLMModel,
} from "~/utils/settings/services";
import { estimateTokens } from "~/utils/token-estimate";
import { createExtractedRegionMatcher } from "~/utils/web-adaptation/extracted-regions";
import {
	type AdaptationPatch,
	AdaptationSuggestion,
	findAdaptationRule,
	matchesPath,
	validatePatch,
} from "~/utils/web-adaptation/model";
import { isSafePageElement } from "~/utils/web-adaptation/structure";
import {
	type ExtractionSample,
	improvesExtraction,
} from "~/utils/web-adaptation/verify";
import { getDomListener } from "../parser";
import {
	getTranslationObservations,
	MAX_ADAPTATION_SOURCE_CHARACTERS,
	OBSERVATION_EVENT,
	type TranslationObservation,
} from "./observations";
import { buildPageSnapshot, matchUntranslatedEvidence } from "./snapshot";

export type WebAdaptationResult =
	| "added"
	| "updated"
	| "unchanged"
	| "noModel"
	| "unavailable"
	| "failed";

async function collectSamples(
	settings: SettingsSchema,
	patch?: AdaptationPatch,
): Promise<ExtractionSample[]> {
	const result: ExtractionSample[] = [];
	let totalCharacters = 0;
	const listener = await getDomListener(
		window.location.hostname,
		{
			listenNew: false,
			filterInteractive: settings.translate.filterInteractive,
		},
		settings.webAdaptation.rules,
		patch,
	);
	for await (const section of listener) {
		const text = getMarkdownFromSection(section).trim();
		const element = section[0].parentElement;
		if (!element || !text) continue;
		if (totalCharacters + text.length > MAX_ADAPTATION_SOURCE_CHARACTERS)
			continue;
		result.push({ text, element });
		totalCharacters += text.length;
	}
	return result;
}

async function collectUntranslatedSamples(
	settings: SettingsSchema,
): Promise<ExtractionSample[]> {
	const extracted = await collectSamples(settings);
	const matchesExtractedRegion = createExtractedRegionMatcher(extracted);
	const samples: ExtractionSample[] = [];
	const seenByElement = new WeakMap<Element, Set<string>>();
	const seenSources = new Set<string>();
	let sourceCharacters = 0;
	const listener = DEFAULT_DOM_LISTENER({
		listenNew: false,
		filterInteractive: settings.translate.filterInteractive,
	});
	for await (const section of listener) {
		const text = getMarkdownFromSection(section).trim();
		const element = section[0].parentElement;
		if (!element || !text || !isSafePageElement(element)) continue;
		const candidate = { text, element };
		if (matchesExtractedRegion(candidate)) continue;
		const key = text.replace(/\s+/g, " ").trim();
		const elementSources = seenByElement.get(element) ?? new Set<string>();
		if (elementSources.has(key)) continue;
		if (
			!seenSources.has(key) &&
			sourceCharacters + text.length > MAX_ADAPTATION_SOURCE_CHARACTERS
		)
			continue;
		if (samples.length >= MAX_ADAPTATION_SOURCE_CHARACTERS) break;
		elementSources.add(key);
		seenByElement.set(element, elementSources);
		if (!seenSources.has(key)) {
			seenSources.add(key);
			sourceCharacters += text.length;
		}
		samples.push(candidate);
	}
	return samples;
}

async function diagnosticPairs(
	settings: SettingsSchema,
): Promise<TranslationObservation[]> {
	const modelId = settings.translate.inTextTranslateModel;
	if (!modelId) return [];
	const maxTokensPerSample =
		findServiceForModelRef(settings.services, modelId)?.queue
			?.maxTokensPerBatch ?? settings.queue.maxTokensPerBatch;
	const samples = (await collectSamples(settings))
		.filter((sample) => estimateTokens(sample.text) <= maxTokensPerSample)
		.slice(0, 3);
	const pairs: TranslationObservation[] = [];
	for (const sample of samples) {
		try {
			const response = await window.rpc.unary(
				{ page: getPageContext() },
				{
					modelId,
					promptId: PROMPT_ID.translate,
					srcLang: settings.translate.sourceLang,
					dstLang: settings.translate.targetLang,
				},
				sample.text,
			);
			const translation = Array.isArray(response.output)
				? response.output.join(" ")
				: response.output;
			if (typeof translation === "string" && translation.trim()) {
				pairs.push({
					source: sample.text,
					translation,
					element: sample.element,
				});
			}
		} catch {
			// A failed diagnostic item should not prevent analysis of the others.
		}
	}
	return pairs;
}

function checkKey(value: string): string {
	let hash = 2166136261;
	for (const char of value) {
		hash ^= char.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function runWebAdaptation(
	source: "manual" | "automatic",
): Promise<WebAdaptationResult> {
	if (!/^https?:$/.test(window.location.protocol) || !document.body)
		return "unavailable";
	await waitRpc();
	const settings = await getSettings();
	const modelId = settings.webAdaptation.modelId;
	if (!modelId || !resolveLLMModel(settings.services, modelId))
		return "noModel";
	if (source === "automatic" && !settings.webAdaptation.autoEnabled)
		return "unchanged";
	const initialUrl = window.location.href;
	let snapshot = buildPageSnapshot();
	if (
		settings.webAdaptation.rules.some(
			(rule) =>
				!rule.enabled &&
				rule.hostname === snapshot.hostname &&
				rule.structureKey === snapshot.structureKey &&
				rule.pathPatterns.some((pattern) =>
					matchesPath(pattern, snapshot.pathname),
				),
		)
	)
		return "unchanged";
	if (
		source === "automatic" &&
		findAdaptationRule(
			settings.webAdaptation.rules,
			snapshot.hostname,
			snapshot.pathname,
			snapshot.structureKey,
		)
	)
		return "unchanged";
	if (source === "automatic" && snapshot.pairs.length < 2) return "unchanged";
	let extraPairs: TranslationObservation[] = [];
	if (source === "manual" && snapshot.pairs.length < 2)
		extraPairs = await diagnosticPairs(settings);
	const untranslatedSamples = await collectUntranslatedSamples(settings);
	snapshot = buildPageSnapshot(extraPairs, untranslatedSamples);
	const verificationSamples = matchUntranslatedEvidence(
		untranslatedSamples,
		snapshot.untranslated,
	);
	let reservedCheckKey: string | undefined;
	const releaseReservedCheck = async () => {
		const key = reservedCheckKey;
		if (!key) return;
		reservedCheckKey = undefined;
		try {
			await window.rpc.releaseWebAdaptationCheck(key);
		} catch {
			// A failed analysis must not remain as a cooldown reservation.
		}
	};
	const completeReservedCheck = async () => {
		const key = reservedCheckKey;
		if (!key) return;
		reservedCheckKey = undefined;
		try {
			await window.rpc.completeWebAdaptationCheck(key);
		} catch {
			try {
				await window.rpc.releaseWebAdaptationCheck(key);
			} catch {
				// Cooldown bookkeeping must not block the analysis result.
			}
		}
	};
	if (snapshot.pairs.length === 0 && snapshot.untranslated.length === 0) {
		return "unavailable";
	}
	if (source === "automatic") {
		const key = checkKey(
			`${snapshot.hostname}|${snapshot.pathname}|${snapshot.structureKey}|${modelId}`,
		);
		if (!(await window.rpc.reserveWebAdaptationCheck(key))) return "unchanged";
		reservedCheckKey = key;
	}
	let response: Awaited<ReturnType<typeof window.rpc.unary>>;
	try {
		response = await window.rpc.unary(
			{},
			{
				modelId,
				promptId: PROMPT_ID.webAdaptation,
				srcLang: "auto",
				dstLang: settings.translate.targetLang,
			},
			JSON.stringify({
				outline: snapshot.outline,
				pairs: snapshot.pairs,
				untranslated: snapshot.untranslated,
			}),
		);
	} catch (error) {
		await releaseReservedCheck();
		throw error;
	}
	let raw: unknown;
	try {
		raw =
			typeof response.output === "string"
				? autoStripMarkdown<unknown>(response.output)
				: response.output;
	} catch {
		await releaseReservedCheck();
		return "failed";
	}
	const suggestion = AdaptationSuggestion.safeParse(raw);
	if (!suggestion.success) {
		await releaseReservedCheck();
		return "failed";
	}
	const hasProposal =
		suggestion.data.roots.length +
			suggestion.data.excludes.length +
			suggestion.data.includes.length +
			suggestion.data.promoteTags.length >
		0;
	if (!hasProposal) {
		await completeReservedCheck();
		return "unchanged";
	}
	const patch = validatePatch(
		{
			roots: suggestion.data.roots,
			excludes: suggestion.data.excludes,
			includes: suggestion.data.includes,
			promoteTags: suggestion.data.promoteTags,
		},
		document,
	);
	if (!patch) {
		await releaseReservedCheck();
		return "failed";
	}
	if (window.location.href !== initialUrl) {
		await completeReservedCheck();
		return "unchanged";
	}
	try {
		const baseline = await collectSamples(settings);
		const candidate = await collectSamples(settings, patch);
		if (
			!improvesExtraction(
				baseline,
				candidate,
				verificationSamples,
				patch.includes.length > 0,
			)
		) {
			await completeReservedCheck();
			return "unchanged";
		}
		const result = await window.rpc.commitWebAdaptation({
			hostname: snapshot.hostname,
			pathname: snapshot.pathname,
			structureKey: snapshot.structureKey,
			source,
			patch,
		});
		await completeReservedCheck();
		return result;
	} catch (error) {
		await releaseReservedCheck();
		throw error;
	}
}

export function initializeWebAdaptation(): void {
	let active: Promise<WebAdaptationResult> | undefined;
	const start = (source: "manual" | "automatic") => {
		if (active) return active;
		active = runWebAdaptation(source)
			.catch(() => "failed" as const)
			.finally(() => {
				active = undefined;
			});
		return active;
	};

	browser.runtime.onMessage.addListener((message: unknown) => {
		if (
			window.top !== window ||
			!message ||
			typeof message !== "object" ||
			!("type" in message) ||
			message.type !== WEB_ADAPTATION_MESSAGE
		)
			return;
		return start("manual");
	});

	let timer: number | undefined;
	let activeTranslationRequests = 0;
	let pendingAutomaticCheck = false;
	const schedule = () => {
		if (getTranslationObservations().length < 2) return;
		pendingAutomaticCheck = true;
		if (timer !== undefined) window.clearTimeout(timer);
		timer = undefined;
		if (activeTranslationRequests > 0) return;
		timer = window.setTimeout(() => {
			timer = undefined;
			if (activeTranslationRequests > 0) return;
			pendingAutomaticCheck = false;
			if (getTranslationObservations().length >= 2) void start("automatic");
		}, 2500);
	};
	const onTranslationActivity = (event: Event) => {
		const count = (event as CustomEvent<number>).detail;
		if (!Number.isFinite(count)) return;
		activeTranslationRequests = Math.max(0, count);
		if (activeTranslationRequests > 0) {
			if (timer !== undefined) window.clearTimeout(timer);
			timer = undefined;
			return;
		}
		if (pendingAutomaticCheck) schedule();
	};
	window.addEventListener(OBSERVATION_EVENT, schedule);
	window.addEventListener(TRANSLATION_ACTIVITY_EVENT, onTranslationActivity);
	listenSettings((settings) => {
		if (settings.webAdaptation?.autoEnabled) schedule();
	});
}
