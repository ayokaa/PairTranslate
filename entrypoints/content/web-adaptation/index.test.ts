import { beforeEach, expect, mock, test } from "bun:test";
import "~/utils/test/dom-setup";
import { PROMPT_ID } from "~/utils/constants";
import type { AdaptationRule } from "~/utils/web-adaptation/model";
import { getStructureKey } from "~/utils/web-adaptation/structure";
import {
	clearTranslationObservations,
	MAX_ADAPTATION_SOURCE_CHARACTERS,
	recordTranslationObservation,
} from "./observations";

const modelId = "00000000-0000-4000-8000-000000000001";
const settings = {
	services: {},
	translate: {
		filterInteractive: false,
		sourceLang: "auto",
		targetLang: "zh-CN",
		inTextTranslateModel: modelId,
	},
	webAdaptation: { autoEnabled: false, modelId, rules: [] },
};

mock.module("#imports", () => ({
	browser: { runtime: { onMessage: { addListener: () => {} } } },
}));
mock.module("~/utils/rpc/wxt-def", () => ({ waitRpc: async () => {} }));
mock.module("~/utils/settings/helper", () => ({
	getSettings: async () => settings,
	listenSettings: () => () => {},
}));
mock.module("~/utils/settings/services", () => ({
	resolveLLMModel: () => ({}),
	findServiceForModelRef: () => ({ queue: { maxTokensPerBatch: Infinity } }),
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
		patch?: unknown,
	) => {
		siteParserScans += 1;
		if (removePageOnSiteScan) document.body.replaceChildren();
		return (async function* () {
			const elements = patch
				? [articleOne, articleTwo, articleText]
				: (siteParserElements ??
					(extractNothingBeforePatch
						? []
						: includeExistingArticleInParser
							? [navText, articleOne, articleTwo]
							: [navText]));
			for (const element of elements) {
				const node = element.firstChild as Node;
				yield [node, node] as const;
			}
		})();
	},
}));

let sentPayload: unknown;
let committed: unknown;
let modelOutput = JSON.stringify({
	roots: [],
	excludes: [],
	includes: ["p.article-text"],
	promoteTags: [],
});
let reservedChecks = 0;
let completedChecks = 0;
let releasedChecks = 0;
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
				if (
					typeof config === "object" &&
					config !== null &&
					"promptId" in config &&
					config.promptId === PROMPT_ID.translate
				)
					return { output: "诊断译文" };
				sentPayload = JSON.parse(text);
				return { output: modelOutput };
			},
			reserveWebAdaptationCheck: async () => {
				reservedChecks += 1;
				return true;
			},
			completeWebAdaptationCheck: async () => {
				completedChecks += 1;
			},
			releaseWebAdaptationCheck: async () => {
				releasedChecks += 1;
			},
			commitWebAdaptation: async (proposal: unknown) => {
				committed = proposal;
				return "added";
			},
		},
	},
});

const { runWebAdaptation } = await import("./index");

beforeEach(() => {
	clearTranslationObservations();
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
	reservedChecks = 0;
	completedChecks = 0;
	releasedChecks = 0;
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

test("manual analysis can propose an include when no translated samples exist", async () => {
	clearTranslationObservations();
	includeExistingArticleInParser = false;
	expect(await runWebAdaptation("manual")).toBe("added");
	expect(sentPayload).toMatchObject({
		pairs: [
			{
				source: "Navigation controls",
				translation: "诊断译文",
			},
		],
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

test("manual analysis can recover text when the site parser extracts nothing", async () => {
	clearTranslationObservations();
	extractNothingBeforePatch = true;
	expect(await runWebAdaptation("manual")).toBe("added");
	expect(sentPayload).toMatchObject({
		pairs: [],
		untranslated: expect.arrayContaining([
			expect.objectContaining({ text: "Useful article paragraph" }),
		]),
	});
	expect(committed).toMatchObject({ patch: { includes: ["p.article-text"] } });
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

test("automatic analysis skips sampling when a matching rule already exists", async () => {
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

	expect(await runWebAdaptation("automatic")).toBe("unchanged");
	expect(siteParserScans).toBe(0);
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

test("automatic analysis does not reserve when the page loses all evidence", async () => {
	settings.webAdaptation.autoEnabled = true;
	removePageOnSiteScan = true;

	expect(await runWebAdaptation("automatic")).toBe("unavailable");
	expect(reservedChecks).toBe(0);
	expect(releasedChecks).toBe(0);
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
