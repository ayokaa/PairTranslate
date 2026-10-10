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
	normalizePathname,
	parseAdaptationRules,
	patchesEqual,
	validatePatch,
} from "~/utils/web-adaptation/model";
import {
	getStructureKey,
	isSafePageElement,
} from "~/utils/web-adaptation/structure";
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
 * Retain the existing sample-count cap for both local extraction indexes and
 * untranslated evidence on extremely fragmented pages. Only outgoing evidence
 * is also restricted by the shared character budget.
 */
const MAX_ADAPTATION_SAMPLE_COUNT = 50_000;
/**
 * Retain the existing evidence threshold for automatic analysis. An explicit
 * manual request can instead supply safe untranslated evidence.
 */
const MIN_ADAPTATION_PAIRS = 2;

export type WebAdaptationResult =
	| "added"
	| "updated"
	| "unchanged"
	| "disabled"
	| "noModel"
	| "unavailable"
	| "failed"
	| "stale";

// Serialize the entire trial, including manual requests made during an
// automatic analysis. Background baseline checks also protect other tabs.
let analysisQueue: Promise<unknown> = Promise.resolve();

export function runWebAdaptation(
	source: "manual" | "automatic",
): Promise<WebAdaptationResult> {
	const result = analysisQueue.then(() => analyzePage(source));
	analysisQueue = result.catch(() => {});
	return result;
}

async function collectSamples(
	rules: AdaptationRule[],
	filterInteractive: boolean,
	patch?: AdaptationPatch,
): Promise<ExtractionSample[]> {
	const result: ExtractionSample[] = [];
	const listener = await getDomListener(
		window.location.hostname,
		{
			listenNew: false,
			filterInteractive,
			// The trial run re-scans a page this extension has already
			// translated, and every translated node carries
			// `data-pt-translated`. Without this the scan sees nothing, the
			// improvement check fails on an empty candidate, and no rule can
			// ever be stored.
			includeTranslated: true,
			// Internal scans must not redefine the page's structure key: the
			// analysis has to store the key the parser will match against.
			recordStructureKey: false,
		},
		rules,
		patch,
	);
	for await (const section of listener) {
		const text = getMarkdownFromSection(section).trim();
		const element = section[0].parentElement;
		if (!element || !text) continue;
		// Local verification must include long-article tails and the recovered
		// region. Only the outgoing snapshot shares the source-character budget.
		// Refuse an incomplete index rather than treating truncated text as missing.
		if (result.length >= MAX_ADAPTATION_SAMPLE_COUNT)
			throw new Error("Page extraction exceeds the adaptation sample limit");
		result.push({ text, element });
	}
	return result;
}

async function collectUntranslatedSamples(
	rules: AdaptationRule[],
	filterInteractive: boolean,
	baselinePatch: AdaptationPatch,
): Promise<ExtractionSample[]> {
	const extracted = await collectSamples(
		rules,
		filterInteractive,
		baselinePatch,
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
		if (samples.length >= MAX_ADAPTATION_SAMPLE_COUNT)
			throw new Error("Page extraction exceeds the adaptation sample limit");
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

async function analyzePage(
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
	const existingRule = findAdaptationRule(
		rules,
		snapshot.hostname,
		snapshot.pathname,
		snapshot.structureKey,
		{ legacyStructureKey: snapshot.legacyStructureKey, includeDisabled: true },
	);
	if (existingRule && !existingRule.enabled) {
		// A disabled rule is a deliberate "do not adapt this layout" decision;
		// report it instead of pretending nothing changed.
		return "disabled";
	}
	if (source === "automatic") {
		if (existingRule?.source === "manual") return "unchanged";
		if (snapshot.pairs.length < MIN_ADAPTATION_PAIRS) return "unchanged";
	}
	const initialStructureKey = snapshot.structureKey;
	const baselinePatch: AdaptationPatch = existingRule?.patch ?? {
		roots: [],
		excludes: [],
		includes: [],
		promoteTags: [],
	};
	let reservedCheckKey: string | undefined;
	let completed = false;
	if (source === "automatic") {
		const key = checkKey(
			`${snapshot.hostname}|${normalizePathname(snapshot.pathname)}|${snapshot.structureKey}|${modelId}`,
		);
		if (!(await window.rpc.reserveWebAdaptationCheck(key))) return "unchanged";
		reservedCheckKey = key;
	}
	try {
		const untranslatedSamples = await collectUntranslatedSamples(
			rules,
			filterInteractive,
			baselinePatch,
		);
		snapshot = buildPageSnapshot([], untranslatedSamples);
		if (snapshot.pairs.length === 0 && snapshot.untranslated.length === 0)
			return "unavailable";
		const pageChanged = () =>
			window.location.href !== initialUrl ||
			getStructureKey(document) !== initialStructureKey;
		if (pageChanged()) return "stale";
		const verificationSamples = matchUntranslatedEvidence(
			untranslatedSamples,
			snapshot.untranslated,
		);
		const response = await window.rpc.unary(
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
				// Additions retain this baseline; removals must name saved excludes.
				currentPatch: existingRule?.patch,
			}),
		);
		if (pageChanged()) return "stale";
		if (
			response.skipped &&
			(typeof response.output !== "string" || !response.output.trim())
		) {
			completed = true;
			return "failed";
		}
		let raw: unknown;
		try {
			raw =
				typeof response.output === "string"
					? autoStripMarkdown<unknown>(response.output)
					: response.output;
		} catch {
			return "failed";
		}
		const suggestion = AdaptationSuggestion.safeParse(raw);
		if (!suggestion.success) return "failed";
		const incoming: AdaptationPatch = {
			roots: suggestion.data.roots,
			excludes: suggestion.data.excludes,
			includes: suggestion.data.includes,
			promoteTags: suggestion.data.promoteTags,
		};
		const removals = suggestion.data.removeExcludes;
		if (
			removals.some(
				(selector) =>
					!baselinePatch.excludes.includes(selector) ||
					incoming.excludes.includes(selector),
			)
		)
			return "failed";
		const hasAdditions = Object.values(incoming).some(
			(items) => items.length > 0,
		);
		const patch = hasAdditions ? validatePatch(incoming, document) : incoming;
		if (!patch) return "failed";
		const finalPatch = appendAdaptationPatch(baselinePatch, patch, removals);
		if (patchesEqual(baselinePatch, finalPatch)) {
			completed = true;
			return "unchanged";
		}
		const requiresAddition =
			removals.length > 0 ||
			finalPatch.includes.some(
				(selector) => !baselinePatch.includes.includes(selector),
			);
		const baseline = await collectSamples(
			rules,
			filterInteractive,
			baselinePatch,
		);
		const candidate = await collectSamples(
			rules,
			filterInteractive,
			finalPatch,
		);
		if (pageChanged()) return "stale";
		// Check the full local extraction index, including content outside new roots.
		const scope = finalPatch.roots.length
			? resolveAdaptationRoots(finalPatch, document)
			: undefined;
		if (
			!improvesExtraction(
				baseline,
				candidate,
				verificationSamples,
				requiresAddition,
				scope,
			)
		) {
			completed = true;
			return "unchanged";
		}
		if (pageChanged()) return "stale";
		const result = await window.rpc.commitWebAdaptation({
			hostname: snapshot.hostname,
			pathname: snapshot.pathname,
			structureKey: snapshot.structureKey,
			legacyStructureKey: snapshot.legacyStructureKey,
			baselineRule: existingRule ?? null,
			source,
			patch: finalPatch,
		});
		completed = result !== "stale";
		return result;
	} finally {
		if (reservedCheckKey) {
			try {
				if (completed)
					await window.rpc.completeWebAdaptationCheck(reservedCheckKey);
				else await window.rpc.releaseWebAdaptationCheck(reservedCheckKey);
			} catch {
				try {
					await window.rpc.releaseWebAdaptationCheck(reservedCheckKey);
				} catch {
					// Bookkeeping cannot override a verified result or request failure.
				}
			}
		}
	}
}

export function initializeWebAdaptation(): void {
	let active: Promise<WebAdaptationResult> | undefined;
	const start = (source: "manual" | "automatic") => {
		if (source === "manual") {
			return runWebAdaptation("manual").catch(() => "failed" as const);
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
		if (getTranslationObservationCount() < MIN_ADAPTATION_PAIRS) return;
		pendingAutomaticCheck = true;
		if (timer !== undefined) window.clearTimeout(timer);
		timer = undefined;
		if (activeTranslationRequests > 0) return;
		timer = window.setTimeout(() => {
			timer = undefined;
			if (activeTranslationRequests > 0) return;
			pendingAutomaticCheck = false;
			if (getTranslationObservationCount() >= MIN_ADAPTATION_PAIRS)
				void start("automatic");
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
