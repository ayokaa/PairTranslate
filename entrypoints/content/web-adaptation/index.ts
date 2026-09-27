import { browser } from "#imports";
import {
	PROMPT_ID,
	TRANSLATION_ACTIVITY_EVENT,
	WEB_ADAPTATION_MESSAGE,
} from "~/utils/constants";
import { autoStripMarkdown } from "~/utils/json-autocomplete";
import { getMarkdownFromSection } from "~/utils/markdown";
import { getPageContext } from "~/utils/page-context";
import { waitRpc } from "~/utils/rpc/wxt-def";
import type { SettingsSchema } from "~/utils/settings/def";
import { getSettings, listenSettings } from "~/utils/settings/helper";
import { resolveLLMModel } from "~/utils/settings/services";
import {
	type AdaptationPatch,
	AdaptationSuggestion,
	findAdaptationRule,
	matchesPath,
	validatePatch,
} from "~/utils/web-adaptation/model";
import {
	type ExtractionSample,
	improvesExtraction,
} from "~/utils/web-adaptation/verify";
import { getDomListener } from "../parser";
import {
	getTranslationObservations,
	OBSERVATION_EVENT,
	type TranslationObservation,
} from "./observations";
import { buildPageSnapshot } from "./snapshot";

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
		if (element && text.length >= 12 && text.length <= 2000) {
			result.push({ text, element });
		}
		if (result.length >= 100) break;
	}
	return result;
}

async function diagnosticPairs(
	settings: SettingsSchema,
): Promise<TranslationObservation[]> {
	const modelId = settings.translate.inTextTranslateModel;
	if (!modelId) return [];
	const samples = (await collectSamples(settings)).slice(0, 3);
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
	let reservedCheckKey: string | undefined;
	if (source === "automatic") {
		if (snapshot.pairs.length < 2) return "unchanged";
		if (
			findAdaptationRule(
				settings.webAdaptation.rules,
				snapshot.hostname,
				snapshot.pathname,
				snapshot.structureKey,
			)
		)
			return "unchanged";
		const key = checkKey(
			`${snapshot.hostname}|${snapshot.pathname}|${snapshot.structureKey}|${modelId}`,
		);
		if (!(await window.rpc.reserveWebAdaptationCheck(key))) return "unchanged";
		reservedCheckKey = key;
	} else if (snapshot.pairs.length < 2) {
		const extra = await diagnosticPairs(settings);
		snapshot = buildPageSnapshot(extra);
	}
	if (snapshot.pairs.length === 0) return "unavailable";

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
			JSON.stringify({ outline: snapshot.outline, pairs: snapshot.pairs }),
		);
	} catch (error) {
		if (reservedCheckKey) {
			try {
				await window.rpc.releaseWebAdaptationCheck(reservedCheckKey);
			} catch {
				// A failed request must not be kept as a cooldown reservation.
			}
		}
		throw error;
	}
	if (reservedCheckKey) {
		try {
			await window.rpc.completeWebAdaptationCheck(reservedCheckKey);
		} catch {
			try {
				await window.rpc.releaseWebAdaptationCheck(reservedCheckKey);
			} catch {
				// Cooldown bookkeeping must not block processing a successful response.
			}
		}
	}
	const raw =
		typeof response.output === "string"
			? autoStripMarkdown<unknown>(response.output)
			: response.output;
	const suggestion = AdaptationSuggestion.safeParse(raw);
	if (!suggestion.success) return "unchanged";
	const patch = validatePatch(
		{
			roots: suggestion.data.roots,
			excludes: suggestion.data.excludes,
			promoteTags: suggestion.data.promoteTags,
		},
		document,
	);
	if (!patch || window.location.href !== initialUrl) return "unchanged";
	const baseline = await collectSamples(settings);
	const candidate = await collectSamples(settings, patch);
	if (!improvesExtraction(baseline, candidate)) return "unchanged";
	return window.rpc.commitWebAdaptation({
		hostname: snapshot.hostname,
		pathname: snapshot.pathname,
		structureKey: snapshot.structureKey,
		source,
		patch,
	});
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
