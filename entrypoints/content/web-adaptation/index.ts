import { browser } from "#imports";
import {
	PROMPT_ID,
	TRANSLATION_ACTIVITY_EVENT,
	WEB_ADAPTATION_MESSAGE,
} from "~/utils/constants";
import { autoStripMarkdown } from "~/utils/json-autocomplete";
import { getMarkdownFromSection } from "~/utils/markdown";
import { DEFAULT_DOM_LISTENER } from "~/utils/parser";
import { waitRpc } from "~/utils/rpc/wxt-def";
import { getSettings, listenSettings } from "~/utils/settings/helper";
import { resolveLLMModel } from "~/utils/settings/services";
import { resolveAdaptationRoots } from "~/utils/web-adaptation/apply";
import { createExtractedRegionMatcher } from "~/utils/web-adaptation/extracted-regions";
import {
	type AdaptationPatch,
	type AdaptationRule,
	AdaptationSuggestion,
	appendAdaptationPatch,
	findAdaptationRule,
	matchesPath,
	normalizePathname,
	parseAdaptationRules,
	validatePatch,
} from "~/utils/web-adaptation/model";
import { isSafePageElement } from "~/utils/web-adaptation/structure";
import {
	type ExtractionSample,
	improvesExtraction,
} from "~/utils/web-adaptation/verify";
import { getDomListener } from "../parser";
import {
	getTranslationObservationCount,
	MAX_ADAPTATION_SOURCE_CHARACTERS,
	OBSERVATION_EVENT,
} from "./observations";
import { buildPageSnapshot, matchUntranslatedEvidence } from "./snapshot";

/**
 * Hard cap on the number of untranslated samples kept for one analysis. The
 * character budget above bounds their text; this bounds the list itself on
 * extremely fragmented pages.
 */
const MAX_ADAPTATION_SAMPLE_COUNT = 50_000;
/**
 * Source/translation pairs required before an analysis may spend the adaptation
 * budget. Both entries share it: the trigger is the only difference between
 * them.
 */
const MIN_ADAPTATION_PAIRS = 2;

export type WebAdaptationResult =
	| "added"
	| "updated"
	| "unchanged"
	| "disabled"
	| "noModel"
	| "unavailable"
	| "failed";

async function collectSamples(
	rules: AdaptationRule[],
	filterInteractive: boolean,
	patch?: AdaptationPatch,
	/**
	 * Bound the collection by the shared character budget.
	 *
	 * A trial run compares a bounded sample, which is enough to judge a change.
	 * The extracted index instead answers "did the site parser extract this
	 * text?" for the whole page, so it must not lose sections to the budget: a
	 * dropped section is reported to the model as untranslated text.
	 */
	characterBudget = true,
): Promise<ExtractionSample[]> {
	const result: ExtractionSample[] = [];
	let totalCharacters = 0;
	const listener = await getDomListener(
		window.location.hostname,
		{
			listenNew: false,
			filterInteractive,
		},
		rules,
		patch,
	);
	for await (const section of listener) {
		const text = getMarkdownFromSection(section).trim();
		const element = section[0].parentElement;
		if (!element || !text) continue;
		if (
			characterBudget &&
			totalCharacters + text.length > MAX_ADAPTATION_SOURCE_CHARACTERS
		)
			continue;
		if (result.length >= MAX_ADAPTATION_SAMPLE_COUNT) break;
		result.push({ text, element });
		totalCharacters += text.length;
	}
	return result;
}

async function collectUntranslatedSamples(
	rules: AdaptationRule[],
	filterInteractive: boolean,
): Promise<ExtractionSample[]> {
	const extracted = await collectSamples(
		rules,
		filterInteractive,
		undefined,
		false,
	);
	const matchesExtractedRegion = createExtractedRegionMatcher(extracted);
	const samples: ExtractionSample[] = [];
	const seenByElement = new WeakMap<Element, Set<string>>();
	const seenSources = new Set<string>();
	let sourceCharacters = 0;
	const listener = DEFAULT_DOM_LISTENER({
		listenNew: false,
		filterInteractive,
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
		if (samples.length >= MAX_ADAPTATION_SAMPLE_COUNT) break;
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
	const rules = parseAdaptationRules(settings.webAdaptation.rules);
	// Adaptation has to judge the same content the translator sees, so a matching
	// website rule overrides the global translation settings here as well.
	const websiteRuleIndex = await window.rpc.matchWebsiteRule(
		window.location.hostname,
	);
	const websiteRule =
		websiteRuleIndex === null
			? undefined
			: settings.websiteRules[websiteRuleIndex];
	const filterInteractive =
		websiteRule?.filterInteractive ?? settings.translate.filterInteractive;
	const dstLang = websiteRule?.targetLang || settings.translate.targetLang;
	const initialUrl = window.location.href;
	let snapshot = buildPageSnapshot();
	const disabledRule = rules.find(
		(rule) =>
			!rule.enabled &&
			rule.hostname === snapshot.hostname &&
			rule.structureKey === snapshot.structureKey &&
			rule.pathPatterns.some((pattern) =>
				matchesPath(pattern, snapshot.pathname),
			),
	);
	if (disabledRule) {
		// A disabled rule is a deliberate "do not adapt this layout" decision;
		// report it instead of pretending nothing changed.
		return "disabled";
	}
	// Manual re-analysis needs to see the rule in force; automatic analysis never
	// re-examines a layout that already has one.
	const existingRule = findAdaptationRule(
		rules,
		snapshot.hostname,
		snapshot.pathname,
		snapshot.structureKey,
	);
	if (source === "automatic" && existingRule) return "unchanged";
	// One evidence rule for both entries: at least two source/translation pairs.
	// The trigger is the only difference between manual and automatic.
	if (snapshot.pairs.length < MIN_ADAPTATION_PAIRS) return "unchanged";
	const untranslatedSamples = await collectUntranslatedSamples(
		rules,
		filterInteractive,
	);
	snapshot = buildPageSnapshot([], untranslatedSamples);
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
			`${snapshot.hostname}|${normalizePathname(snapshot.pathname)}|${snapshot.structureKey}|${modelId}`,
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
				dstLang,
			},
			JSON.stringify({
				outline: snapshot.outline,
				pairs: snapshot.pairs,
				untranslated: snapshot.untranslated,
				// The model sees the rule in force: its proposal is appended to
				// this patch, so it only has to mention what it wants to add.
				currentPatch: existingRule?.patch,
			}),
		);
	} catch (error) {
		await releaseReservedCheck();
		throw error;
	}
	// A skipped response carries no suggestion: the same-language short-circuit
	// answers with an empty string, which used to surface as a JSON parse
	// failure. Report the real outcome, and settle the check so the seven-day
	// cooldown applies instead of retrying on every translation batch.
	if (
		response.skipped &&
		(typeof response.output !== "string" || !response.output.trim())
	) {
		await completeReservedCheck();
		return "failed";
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
	// The saved rule is appended to, never rewritten: what the trial run checks
	// is exactly what gets stored.
	const finalPatch = appendAdaptationPatch(existingRule?.patch, patch);
	try {
		const baseline = await collectSamples(rules, filterInteractive);
		const candidate = await collectSamples(
			rules,
			filterInteractive,
			finalPatch,
		);
		// A root change can hide content the sampling budget never reached, so the
		// trial also checks that no baseline sample fell outside the new roots.
		const scope = finalPatch.roots.length
			? resolveAdaptationRoots(finalPatch, document)
			: undefined;
		if (
			!improvesExtraction(
				baseline,
				candidate,
				verificationSamples,
				finalPatch.includes.length > 0,
				scope,
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
			patch: finalPatch,
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
	// Manual requests belong to separate clicks, so they queue behind whatever is
	// running instead of silently reusing an automatic analysis in flight.
	let manualQueue: Promise<unknown> = Promise.resolve();
	const start = (source: "manual" | "automatic") => {
		if (source === "manual") {
			const task = manualQueue.then(() =>
				runWebAdaptation("manual").catch(() => "failed" as const),
			);
			manualQueue = task.then(
				() => undefined,
				() => undefined,
			);
			return task;
		}
		if (active) return active;
		active = runWebAdaptation("automatic")
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
		// Only the top frame analyses automatically: sub-frames would spend the
		// adaptation budget on hosts the user never asked about.
		if (window.top !== window) return;
		if (getTranslationObservationCount() < 2) return;
		pendingAutomaticCheck = true;
		if (timer !== undefined) window.clearTimeout(timer);
		timer = undefined;
		if (activeTranslationRequests > 0) return;
		timer = window.setTimeout(() => {
			timer = undefined;
			if (activeTranslationRequests > 0) return;
			pendingAutomaticCheck = false;
			if (getTranslationObservationCount() >= 2) void start("automatic");
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
