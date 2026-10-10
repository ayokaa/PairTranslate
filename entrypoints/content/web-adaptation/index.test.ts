import { beforeEach, expect, mock, test } from "bun:test";
import "~/utils/test/dom-setup";
import { PROMPT_ID } from "~/utils/constants";
import type { ServiceSettings } from "~/utils/settings";
import type { ResolvedLLMModel } from "~/utils/settings/services";
import * as realSettingsServicesModule from "~/utils/settings/services";
import {
	type AdaptationPatch,
	type AdaptationProposal,
	type AdaptationRule,
	upsertAdaptationRule,
} from "~/utils/web-adaptation/model";
import {
	getStructureKey,
	resetLastStructureKey,
} from "~/utils/web-adaptation/structure";
import {
	clearTranslationObservations,
	MAX_ADAPTATION_SOURCE_CHARACTERS,
	recordTranslationObservation,
} from "./observations";

const modelId = "00000000-0000-4000-8000-000000000001";
const settings = {
	services: {},
	websiteRules: [] as Array<Record<string, unknown>>,
	queue: { maxTokensPerBatch: Infinity, maxBatchSize: 10 },
	translate: {
		filterInteractive: false,
		sourceLang: "auto",
		targetLang: "zh-CN",
		inTextTranslateModel: modelId,
	},
	webAdaptation: { autoEnabled: false, modelId, rules: [] as AdaptationRule[] },
};

mock.module("#imports", () => ({
	browser: { runtime: { onMessage: { addListener: () => {} } } },
}));
mock.module("~/utils/rpc/wxt-def", () => ({ waitRpc: async () => {} }));
mock.module("~/utils/settings/helper", () => ({
	// Keep every export: a partial mock leaks into other test files.
	getSettings: async () => settings,
	saveSettings: async (next: unknown) => {
		Object.assign(settings, next as Record<string, unknown>);
	},
	listenSettings: () => () => {},
	listenEnabled: () => () => {},
	getSettingsMigrationError: async () => undefined,
	clearSettingsMigrationError: async () => {},
}));
// The test settings reference an adaptation model without registering a
// service for it, so model lookup falls back to a stub result.
//
// Every other export delegates to the real module: Bun keeps module mocks
// process-wide, and a blanket stub here used to leak into later test files,
// where lookups then answered with an empty model for any input.
//
// Snapshot the module before mocking it: mock.module patches exported bindings
// in place, so a later read through the namespace would call back into the
// mock itself.
const realSettingsServices = { ...realSettingsServicesModule };
mock.module("~/utils/settings/services", () => ({
	...realSettingsServices,
	resolveLLMModel: (
		services: Record<string, ServiceSettings>,
		modelId: string | undefined,
	): ResolvedLLMModel | undefined =>
		realSettingsServices.resolveLLMModel(services, modelId) ??
		({} as ResolvedLLMModel),
}));
mock.module("~/utils/page-context", () => ({ getPageContext: () => ({}) }));

const nav = document.createElement("nav");
const navText = document.createElement("p");
navText.textContent = "Navigation controls";
nav.append(navText);
const main = document.createElement("main");
main.className = "article";
const articleOne = document.createElement("p");
articleOne.className = "translated-one";
articleOne.textContent = "Article paragraph one";
const articleTwo = document.createElement("p");
articleTwo.className = "translated-two";
articleTwo.textContent = "Article paragraph two";
const articleText = document.createElement("p");
articleText.className = "article-text";
articleText.textContent = "Useful article paragraph";
main.append(articleOne, articleTwo, articleText);
document.body.append(nav, main);

let includeExistingArticleInParser = true;
let extractNothingBeforePatch = false;
let siteParserElements: Element[] | undefined;
let siteParserScans = 0;
let removePageOnSiteScan = false;

mock.module("../parser", () => ({
	getDomListener: async (
		_domain: string,
		_options: unknown,
		_rules: unknown,
		patch?: AdaptationPatch,
	) => {
		siteParserScans += 1;
		if (removePageOnSiteScan) document.body.replaceChildren();
		return (async function* () {
			let elements = [
				...(siteParserElements ??
					(extractNothingBeforePatch
						? []
						: includeExistingArticleInParser
							? [navText, articleOne, articleTwo]
							: [navText])),
			];
			if (
				patch?.includes.includes("p.article-text") &&
				!elements.includes(articleText)
			)
				elements.push(articleText);
			if (patch?.roots.length)
				elements = elements.filter((element) =>
					patch.roots.some((selector) => {
						const root = document.querySelector(selector);
						return root === element || root?.contains(element);
					}),
				);
			if (patch?.excludes.length)
				elements = elements.filter(
					(element) => !element.closest(patch.excludes.join(", ")),
				);
			for (const element of elements) {
				const node = element.firstChild as Node;
				yield [node, node] as const;
			}
		})();
	},
}));

let sentPayload: unknown;
let sentRequests: Array<{ srcLang: string; dstLang: string }> = [];
let committed: unknown;
let modelOutput = JSON.stringify({
	roots: [],
	excludes: [],
	includes: ["p.article-text"],
	promoteTags: [],
});
let matchedWebsiteRuleIndex: number | null = null;
let skippedResponse = false;
let diagnosticOutput = "诊断译文";
let reservedChecks = 0;
let completedChecks = 0;
let releasedChecks = 0;
let reserveAllowed = true;
let onModelRequest: (() => Promise<void>) | undefined;
Object.assign(globalThis, {
	window: {
		location: {
			protocol: "https:",
			href: "https://example.com/article/one",
			hostname: "example.com",
			pathname: "/article/one",
		},
		rpc: {
			unary: async (_ctx: unknown, config: unknown, text: string) => {
				sentRequests.push(config as { srcLang: string; dstLang: string });
				if (
					typeof config === "object" &&
					config !== null &&
					"promptId" in config &&
					config.promptId === PROMPT_ID.translate
				)
					return { output: diagnosticOutput };
				if (skippedResponse) return { output: "", skipped: true };
				sentPayload = JSON.parse(text);
				const output = modelOutput;
				await onModelRequest?.();
				return { output };
			},
			reserveWebAdaptationCheck: async () => {
				reservedChecks += 1;
				return reserveAllowed;
			},
			completeWebAdaptationCheck: async () => {
				completedChecks += 1;
			},
			releaseWebAdaptationCheck: async () => {
				releasedChecks += 1;
			},
			commitWebAdaptation: async (proposal: unknown) => {
				committed = proposal;
				const result = upsertAdaptationRule(
					settings.webAdaptation.rules,
					proposal as AdaptationProposal,
					Date.now(),
				);
				settings.webAdaptation.rules = result.rules;
				return result.result;
			},
			matchWebsiteRule: async () => matchedWebsiteRuleIndex,
			deleteWebAdaptationRule: async () => true,
		},
	},
});

const { runWebAdaptation } = await import("./index");

beforeEach(() => {
	clearTranslationObservations();
	// The parser records the page's structure key in module state; other test
	// files share both the module and the document, so start from a clean slate.
	resetLastStructureKey();
	document.body.replaceChildren(nav, main);
	includeExistingArticleInParser = true;
	extractNothingBeforePatch = false;
	siteParserElements = undefined;
	siteParserScans = 0;
	removePageOnSiteScan = false;
	settings.webAdaptation.autoEnabled = false;
	settings.webAdaptation.rules = [];
	modelOutput = JSON.stringify({
		roots: [],
		excludes: [],
		includes: ["p.article-text"],
		promoteTags: [],
	});
	sentPayload = undefined;
	committed = undefined;
	matchedWebsiteRuleIndex = null;
	skippedResponse = false;
	diagnosticOutput = "诊断译文";
	sentRequests = [];
	reservedChecks = 0;
	completedChecks = 0;
	releasedChecks = 0;
	reserveAllowed = true;
	onModelRequest = undefined;
	window.location.href = "https://example.com/article/one";
	window.location.pathname = "/article/one";
	const firstNode = articleOne.firstChild;
	const secondNode = articleTwo.firstChild;
	if (!firstNode || !secondNode) throw new Error("Expected article text nodes");
	recordTranslationObservation(
		[firstNode, firstNode],
		"Article paragraph one",
		"译文一",
	);
	recordTranslationObservation(
		[secondNode, secondNode],
		"Article paragraph two",
		"译文二",
	);
});

test("manual analysis sends untranslated text, then commits a validated include rule", async () => {
	expect(await runWebAdaptation("manual")).toBe("added");
	expect(sentPayload).toMatchObject({
		pairs: [
			{ source: "Article paragraph one", translation: "译文一" },
			{ source: "Article paragraph two", translation: "译文二" },
		],
		untranslated: [
			{
				text: "Useful article paragraph",
				paths: ["main.article > p.article-text"],
			},
		],
	});
	expect(committed).toMatchObject({
		hostname: "example.com",
		pathname: "/article/one",
		source: "manual",
		patch: {
			roots: [],
			excludes: [],
			includes: ["p.article-text"],
			promoteTags: [],
		},
	});
});

test("manual recovery can use missing content when automatic evidence is insufficient", async () => {
	clearTranslationObservations();
	includeExistingArticleInParser = false;

	settings.webAdaptation.autoEnabled = true;
	recordTranslationObservation(
		[articleOne.firstChild as Node, articleOne.firstChild as Node],
		"Article paragraph one",
		"译文一",
	);
	expect(await runWebAdaptation("automatic")).toBe("unchanged");
	expect(sentPayload).toBeUndefined();
	expect(siteParserScans).toBe(0);

	expect(await runWebAdaptation("manual")).toBe("added");
	expect(sentPayload).toMatchObject({
		untranslated: [
			{ text: "Article paragraph one" },
			{ text: "Article paragraph two" },
			{ text: "Useful article paragraph" },
		],
	});
	expect(committed).toMatchObject({
		patch: { includes: ["p.article-text"] },
	});
});

test("site parser sampling skips an oversized section and scans later sections", async () => {
	const later = document.createElement("p");
	later.textContent = "Later section already extracted by the site parser";
	const oversized = document.createElement("p");
	oversized.textContent = "x".repeat(MAX_ADAPTATION_SOURCE_CHARACTERS + 1);
	main.append(later, oversized);
	siteParserElements = [
		oversized,
		navText,
		articleOne,
		articleTwo,
		articleText,
		later,
	];
	modelOutput = JSON.stringify({
		roots: [],
		excludes: [],
		includes: [],
		promoteTags: [],
	});

	expect(await runWebAdaptation("manual")).toBe("unchanged");
	expect(sentPayload).toMatchObject({ untranslated: [] });
	later.remove();
	oversized.remove();
});

test("untranslated sampling continues after an oversized sample", async () => {
	const oversized = document.createElement("p");
	oversized.textContent = "x".repeat(MAX_ADAPTATION_SOURCE_CHARACTERS + 1);
	const later = document.createElement("p");
	later.textContent = "Later unextracted section";
	main.append(oversized, later);
	siteParserElements = [navText, articleOne, articleTwo, articleText];
	modelOutput = JSON.stringify({
		roots: [],
		excludes: [],
		includes: [],
		promoteTags: [],
	});

	expect(await runWebAdaptation("manual")).toBe("unchanged");
	expect(sentPayload).toMatchObject({
		untranslated: expect.arrayContaining([
			expect.objectContaining({ text: "Later unextracted section" }),
		]),
	});
	oversized.remove();
	later.remove();
});

test("automatic analysis skips full-page sampling when observed pairs are insufficient", async () => {
	clearTranslationObservations();
	settings.webAdaptation.autoEnabled = true;

	expect(await runWebAdaptation("automatic")).toBe("unchanged");
	expect(siteParserScans).toBe(0);
});

test("automatic analysis improves a saved automatic rule after its cooldown", async () => {
	settings.webAdaptation.autoEnabled = true;
	(settings.webAdaptation.rules as AdaptationRule[]).push({
		id: modelId,
		hostname: "example.com",
		pathPatterns: ["/article/one"],
		structureKey: getStructureKey(document),
		enabled: true,
		source: "automatic",
		patch: { roots: [], excludes: ["nav"], includes: [], promoteTags: [] },
		createdAt: 1,
		updatedAt: 1,
	});

	expect(await runWebAdaptation("automatic")).toBe("updated");
	expect(reservedChecks).toBe(1);
	expect(committed).toMatchObject({
		baselineRule: { patch: { excludes: ["nav"] } },
		patch: { excludes: ["nav"], includes: ["p.article-text"] },
	});
});

test("automatic analysis releases its reservation when the model returns an invalid schema", async () => {
	settings.webAdaptation.autoEnabled = true;
	modelOutput = JSON.stringify({
		roots: "main",
		excludes: [],
		includes: [],
		promoteTags: [],
	});

	expect(await runWebAdaptation("automatic")).toBe("failed");
	expect(reservedChecks).toBe(1);
	expect(releasedChecks).toBe(1);
	expect(completedChecks).toBe(0);
	expect(committed).toBeUndefined();
});

test("automatic analysis releases an early reservation when evidence disappears", async () => {
	settings.webAdaptation.autoEnabled = true;
	removePageOnSiteScan = true;

	expect(await runWebAdaptation("automatic")).toBe("unavailable");
	expect(reservedChecks).toBe(1);
	expect(releasedChecks).toBe(1);
	expect(completedChecks).toBe(0);
});

test("manual analysis accepts more than three roots when extraction improves", async () => {
	modelOutput = JSON.stringify({
		roots: ["main.article", "nav", "p.translated-one", "p.translated-two"],
		excludes: [],
		includes: ["p.article-text"],
		promoteTags: [],
	});

	expect(await runWebAdaptation("manual")).toBe("added");
	expect(committed).toMatchObject({
		patch: {
			roots: ["main.article", "nav", "p.translated-one", "p.translated-two"],
			includes: ["p.article-text"],
		},
	});
});

test("automatic analysis releases its reservation when the model returns invalid JSON", async () => {
	settings.webAdaptation.autoEnabled = true;
	modelOutput = "{ invalid json";

	expect(await runWebAdaptation("automatic")).toBe("failed");
	expect(reservedChecks).toBe(1);
	expect(releasedChecks).toBe(1);
	expect(completedChecks).toBe(0);
	expect(committed).toBeUndefined();
});

test("automatic analysis releases its reservation for an unsafe selector", async () => {
	settings.webAdaptation.autoEnabled = true;
	modelOutput = JSON.stringify({
		roots: [],
		excludes: [],
		includes: ["p:has(code)"],
		promoteTags: [],
	});

	expect(await runWebAdaptation("automatic")).toBe("failed");
	expect(reservedChecks).toBe(1);
	expect(releasedChecks).toBe(1);
	expect(completedChecks).toBe(0);
	expect(committed).toBeUndefined();
});

test("a valid empty suggestion is unchanged and completes its reservation", async () => {
	settings.webAdaptation.autoEnabled = true;
	modelOutput = JSON.stringify({
		roots: [],
		excludes: [],
		includes: [],
		promoteTags: [],
	});

	expect(await runWebAdaptation("automatic")).toBe("unchanged");
	expect(reservedChecks).toBe(1);
	expect(releasedChecks).toBe(0);
	expect(completedChecks).toBe(1);
	expect(committed).toBeUndefined();
});

test("manual analysis reports a disabled rule instead of no change", async () => {
	settings.webAdaptation.rules = [
		{
			id: modelId,
			hostname: "example.com",
			pathPatterns: ["/article/one"],
			structureKey: getStructureKey(document),
			enabled: false,
			source: "automatic",
			patch: { roots: [], excludes: ["nav"], includes: [], promoteTags: [] },
			createdAt: 1,
			updatedAt: 1,
		},
	];

	expect(await runWebAdaptation("manual")).toBe("disabled");
	expect(await runWebAdaptation("automatic")).toBe("unchanged");
});

test("site rule settings drive the adaptation request", async () => {
	settings.websiteRules = [
		{
			urlPatterns: ["example.com"],
			filterInteractive: true,
			targetLang: "ja",
			sourceLang: "de",
		},
	];
	matchedWebsiteRuleIndex = 0;

	expect(await runWebAdaptation("manual")).toBe("added");
	expect(
		(sentPayload as { currentPatch?: unknown }).currentPatch,
	).toBeUndefined();
	expect(sentRequests.at(-1)?.dstLang).toBe("ja");
});

test("a saved rule is offered to the model when re-analysing manually", async () => {
	settings.webAdaptation.rules = [
		{
			id: modelId,
			hostname: "example.com",
			pathPatterns: ["/article/one"],
			structureKey: getStructureKey(document),
			enabled: true,
			source: "automatic",
			patch: {
				roots: ["main.article"],
				excludes: ["nav"],
				includes: [],
				promoteTags: [],
			},
			createdAt: 1,
			updatedAt: 1,
		},
	];

	expect(await runWebAdaptation("manual")).toBe("updated");
	// The model sees the rule in force...
	expect(
		(sentPayload as { currentPatch?: { roots: string[] } }).currentPatch?.roots,
	).toEqual(["main.article"]);
	// ...and its proposal is appended to it, never replacing it.
	expect(committed).toMatchObject({
		patch: {
			roots: ["main.article"],
			excludes: ["nav"],
			includes: ["p.article-text"],
			promoteTags: [],
		},
	});
	// The manual update is now protected from automatic editing.
	settings.webAdaptation.autoEnabled = true;
	expect(await runWebAdaptation("automatic")).toBe("unchanged");
});

test("a skipped model response is reported as a failure, not a parse error", async () => {
	settings.webAdaptation.autoEnabled = true;
	skippedResponse = true;

	expect(await runWebAdaptation("automatic")).toBe("failed");
	// The check is settled, so the seven-day cooldown applies instead of
	// retrying the same payload on every translation batch.
	expect(reservedChecks).toBe(1);
	expect(releasedChecks).toBe(0);
	expect(completedChecks).toBe(1);
	expect(committed).toBeUndefined();
});

test("the extracted index keeps sections beyond the character budget", async () => {
	// A long article: the trial-run budget covers only the leading sections,
	// but the "already extracted?" index must answer for the whole page, or the
	// tail is reported to the model as untranslated text.
	const created: Element[] = [];
	for (let i = 0; i < 50; i++) {
		const filler = document.createElement("p");
		filler.className = "filler-section";
		filler.textContent = "z".repeat(1000);
		main.append(filler);
		created.push(filler);
	}
	const tail = document.createElement("p");
	tail.className = "tail-section";
	tail.textContent = "Tail section already extracted by the site parser".repeat(
		20,
	);
	main.append(tail);
	created.push(tail);
	siteParserElements = [
		navText,
		articleOne,
		articleTwo,
		articleText,
		...created,
	];
	modelOutput = JSON.stringify({
		roots: [],
		excludes: [],
		includes: [],
		promoteTags: [],
	});

	expect(await runWebAdaptation("manual")).toBe("unchanged");
	expect(sentPayload).toMatchObject({ untranslated: [] });
	for (const element of created) element.remove();
});

test("manual analysis recovers filtered text even when there are no translated pairs", async () => {
	clearTranslationObservations();
	includeExistingArticleInParser = false;
	extractNothingBeforePatch = true;

	settings.webAdaptation.autoEnabled = true;
	expect(await runWebAdaptation("automatic")).toBe("unchanged");
	expect(sentPayload).toBeUndefined();
	expect(siteParserScans).toBe(0);
	expect(await runWebAdaptation("manual")).toBe("added");
	expect(sentPayload).toMatchObject({
		pairs: [],
		untranslated: expect.arrayContaining([
			expect.objectContaining({ text: "Useful article paragraph" }),
		]),
	});
});

test("cooldown skips sampling even when an automatic rule already matches", async () => {
	settings.webAdaptation.autoEnabled = true;
	reserveAllowed = false;
	settings.webAdaptation.rules = [
		{
			id: modelId,
			hostname: "example.com",
			pathPatterns: ["/article/one"],
			structureKey: getStructureKey(document),
			enabled: true,
			source: "automatic",
			patch: { roots: [], excludes: ["nav"], includes: [], promoteTags: [] },
			createdAt: 1,
			updatedAt: 1,
		},
	];
	expect(await runWebAdaptation("automatic")).toBe("unchanged");
	expect(reservedChecks).toBe(1);
	expect(siteParserScans).toBe(0);
	expect(sentPayload).toBeUndefined();
});

test("manual analysis queues behind the automatic trial and retains its recovered content", async () => {
	settings.webAdaptation.autoEnabled = true;
	let entered!: () => void;
	let resume!: () => void;
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const paused = new Promise<void>((resolve) => {
		resume = resolve;
	});
	let firstRequest = true;
	onModelRequest = async () => {
		if (firstRequest) {
			firstRequest = false;
			entered();
			await paused;
		}
	};
	const automatic = runWebAdaptation("automatic");
	await started;
	const manual = runWebAdaptation("manual");
	await Promise.resolve();
	expect(sentRequests).toHaveLength(1);
	modelOutput = JSON.stringify({
		roots: [],
		excludes: ["nav"],
		includes: [],
		promoteTags: [],
	});
	resume();
	expect(await Promise.all([automatic, manual])).toEqual(["added", "updated"]);
	expect(settings.webAdaptation.rules.map((rule) => rule.patch)).toEqual([
		{
			roots: [],
			excludes: ["nav"],
			includes: ["p.article-text"],
			promoteTags: [],
		},
	]);
	expect(sentRequests).toHaveLength(2);
});

test("a cross-context rule change rejects the stale trial and releases its cooldown", async () => {
	settings.webAdaptation.autoEnabled = true;
	onModelRequest = async () => {
		settings.webAdaptation.rules = [
			{
				id: modelId,
				hostname: "example.com",
				pathPatterns: ["/article/one"],
				structureKey: getStructureKey(document),
				enabled: true,
				source: "manual",
				patch: { roots: [], excludes: ["nav"], includes: [], promoteTags: [] },
				createdAt: 1,
				updatedAt: 1,
			},
		];
	};
	expect(await runWebAdaptation("automatic")).toBe("stale");
	expect(settings.webAdaptation.rules[0].patch.includes).toEqual([]);
	expect(settings.webAdaptation.rules[0].patch.excludes).toEqual(["nav"]);
	expect(releasedChecks).toBe(1);
	expect(completedChecks).toBe(0);
});

test("navigation during a model request cannot commit to the new page", async () => {
	settings.webAdaptation.autoEnabled = true;
	onModelRequest = async () => {
		window.location.href = "https://example.com/article/other";
		window.location.pathname = "/article/other";
	};
	expect(await runWebAdaptation("automatic")).toBe("stale");
	expect(committed).toBeUndefined();
	expect(releasedChecks).toBe(1);
	expect(completedChecks).toBe(0);
});
