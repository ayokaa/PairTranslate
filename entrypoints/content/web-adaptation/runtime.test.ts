import { beforeEach, expect, mock, test } from "bun:test";
import "~/utils/test/dom-setup";
import { getMarkdownFromSection } from "~/utils/markdown";
import { PARSER_LIST } from "~/utils/parser";
import type { ServiceSettings } from "~/utils/settings";
import type { ResolvedLLMModel } from "~/utils/settings/services";
import * as settingsServicesModule from "~/utils/settings/services";
import type { AdaptationRule } from "~/utils/web-adaptation/model";
import {
	getLegacyStructureKey,
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
	websiteRules: [],
	translate: { filterInteractive: false, targetLang: "zh-CN" },
	webAdaptation: { modelId, autoEnabled: false, rules: [] as AdaptationRule[] },
};
const stored: Record<string, unknown> = {};
mock.module("#imports", () => ({
	browser: {
		runtime: { onMessage: { addListener: () => {} } },
		storage: {
			local: {
				get: async (key: string) => ({ [key]: stored[key] }),
				set: async (values: Record<string, unknown>) =>
					Object.assign(stored, values),
			},
		},
	},
}));
mock.module("~/utils/rpc/wxt-def", () => ({ waitRpc: async () => {} }));
mock.module("~/utils/settings/helper", () => ({
	getSettings: async () => settings,
	saveSettings: async (next: unknown) => Object.assign(settings, next),
	listenSettings: () => () => {},
	listenEnabled: () => () => {},
	getSettingsMigrationError: async () => undefined,
	clearSettingsMigrationError: async () => {},
}));
const realServices = { ...settingsServicesModule };
mock.module("~/utils/settings/services", () => ({
	...realServices,
	resolveLLMModel: (
		services: Record<string, ServiceSettings>,
		id: string | undefined,
	): ResolvedLLMModel | undefined =>
		realServices.resolveLLMModel(services, id) ??
		(id === modelId ? ({} as ResolvedLLMModel) : undefined),
}));

const { createWebAdaptationService } = await import(
	"~/entrypoints/background/services/web-adaptation"
);
const { getDomListener } = await import("../parser");
const { runWebAdaptation } = await import("./index");
let parserIndex: number | null;
let modelOutput: unknown;
let onModelRequest: (() => void) | undefined;
let payload: {
	pairs: Array<{ source: string }>;
	untranslated: Array<{ text: string }>;
	currentPatch?: unknown;
};

function observe(element: Element) {
	const node = element.firstChild;
	if (!node) throw new Error("Fixture must contain text");
	recordTranslationObservation(
		[node, node],
		element.textContent!,
		`译文：${element.textContent}`,
	);
}

function savedRule(
	patch: AdaptationRule["patch"],
	legacy = false,
): AdaptationRule {
	const now = Date.now();
	return {
		id: modelId,
		hostname: window.location.hostname,
		pathPatterns: [window.location.pathname],
		structureKey: legacy
			? getLegacyStructureKey(document)
			: getStructureKey(document),
		enabled: true,
		source: "automatic",
		patch,
		createdAt: now,
		updatedAt: now,
	};
}

async function extractedText(): Promise<string[]> {
	const result: string[] = [];
	for await (const section of await getDomListener(window.location.hostname, {
		listenNew: false,
		filterInteractive: false,
	}))
		result.push(getMarkdownFromSection(section));
	return result;
}

beforeEach(() => {
	clearTranslationObservations();
	resetLastStructureKey();
	for (const key of Object.keys(stored)) delete stored[key];
	document.body.innerHTML = `
		<nav><p>Navigation links</p></nav>
		<main class="article">
			<p class="first">First body paragraph</p>
			<p class="second">Second body paragraph</p>
			<div class="Box-header"><p class="recovered">Useful missed body paragraph</p></div>
		</main>
	`;
	settings.webAdaptation.autoEnabled = false;
	settings.webAdaptation.rules = [];
	parserIndex = PARSER_LIST.findIndex((parser) =>
		parser.urlPatterns.includes("github.com"),
	);
	modelOutput = {
		roots: [],
		excludes: [],
		includes: ["p.recovered"],
		promoteTags: [],
	};
	onModelRequest = undefined;
	Object.assign(globalThis, {
		// Use the same CSS.escape shim as the existing static adaptation E2E script.
		CSS: {
			escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&"),
		},
		window: {
			location: {
				protocol: "https:",
				hostname: "github.com",
				href: "https://github.com/example/project/issues/example",
				pathname: "/example/project/issues/example",
			},
			rpc: {
				...createWebAdaptationService(),
				matchParser: async () => parserIndex,
				matchWebsiteRule: async () => null,
				unary: async (_ctx: unknown, _config: unknown, text: string) => {
					payload = JSON.parse(text);
					onModelRequest?.();
					return { output: JSON.stringify(modelOutput) };
				},
			},
		},
	});
	for (const element of document.querySelectorAll("p.first, p.second"))
		observe(element);
});

test("a real site parser and background service recover text without translated pairs", async () => {
	clearTranslationObservations();
	expect(await extractedText()).not.toContain("Useful missed body paragraph");
	expect(await runWebAdaptation("manual")).toBe("added");
	expect(payload.pairs).toEqual([]);
	expect(await extractedText()).toContain("Useful missed body paragraph");
	expect(settings.webAdaptation.rules[0].patch.includes).toEqual([
		"p.recovered",
	]);
});

test("a saved include does not block a later navigation exclusion", async () => {
	expect(await runWebAdaptation("manual")).toBe("added");
	modelOutput = { roots: [], excludes: ["nav"], includes: [], promoteTags: [] };
	expect(await runWebAdaptation("manual")).toBe("updated");
	expect(settings.webAdaptation.rules[0].patch.includes).toEqual([
		"p.recovered",
	]);
	expect(await extractedText()).toEqual([
		"First body paragraph",
		"Second body paragraph",
		"Useful missed body paragraph",
	]);
});

test("a saved wrong exclusion can be removed with verified body evidence", async () => {
	parserIndex = null;
	settings.webAdaptation.rules = [
		savedRule({
			roots: [],
			excludes: ["p.recovered"],
			includes: [],
			promoteTags: [],
		}),
	];
	modelOutput = { removeExcludes: ["p.recovered"] };
	expect(await extractedText()).not.toContain("Useful missed body paragraph");
	expect(await runWebAdaptation("manual")).toBe("updated");
	expect(settings.webAdaptation.rules).toEqual([]);
	expect(await extractedText()).toContain("Useful missed body paragraph");
});

test("removing a saved exclusion cannot undo the site's own exclusion", async () => {
	const original = savedRule({
		roots: [],
		excludes: ["p.recovered"],
		includes: [],
		promoteTags: [],
	});
	settings.webAdaptation.rules = [original];
	modelOutput = { removeExcludes: ["p.recovered"] };
	expect(await runWebAdaptation("manual")).toBe("unchanged");
	expect(settings.webAdaptation.rules).toEqual([original]);
	expect(await extractedText()).not.toContain("Useful missed body paragraph");
});

test("a removal that admits navigation is rejected", async () => {
	const original = savedRule({
		roots: [],
		excludes: ["nav"],
		includes: [],
		promoteTags: [],
	});
	settings.webAdaptation.rules = [original];
	modelOutput = { removeExcludes: ["nav"] };
	expect(await runWebAdaptation("manual")).toBe("unchanged");
	expect(settings.webAdaptation.rules).toEqual([original]);
	expect(await extractedText()).not.toContain("Navigation links");
});

test("a legacy rule continues translating and upgrades after a verified change", async () => {
	const original = savedRule(
		{ roots: [], excludes: ["nav"], includes: [], promoteTags: [] },
		true,
	);
	settings.webAdaptation.rules = [original];
	expect(await extractedText()).not.toContain("Navigation links");
	expect(await runWebAdaptation("manual")).toBe("updated");
	expect(settings.webAdaptation.rules[0].id).toBe(original.id);
	expect(settings.webAdaptation.rules[0].structureKey).toBe(
		getStructureKey(document),
	);
	expect(await extractedText()).toContain("Useful missed body paragraph");
});

test("a recovered tail is verified even when translated source reaches the request budget", async () => {
	clearTranslationObservations();
	const first = document.querySelector("p.first")!;
	const sentence = "Already translated body sentence. ";
	first.textContent = sentence
		.repeat(Math.ceil(MAX_ADAPTATION_SOURCE_CHARACTERS / sentence.length))
		.slice(0, MAX_ADAPTATION_SOURCE_CHARACTERS);
	observe(first);
	expect(await runWebAdaptation("manual")).toBe("added");
	expect(payload.untranslated).toContainEqual(
		expect.objectContaining({ text: "Useful missed body paragraph" }),
	);
	expect(await extractedText()).toContain(first.textContent!.trim());
	expect(await extractedText()).toContain("Useful missed body paragraph");
});

test("a narrowing root cannot discard body content beyond the outgoing budget", async () => {
	parserIndex = null;
	clearTranslationObservations();
	const main = document.querySelector("main")!;
	main.innerHTML = `<div class="partial"><p class="first"></p><p>Second body paragraph</p></div><p>Tail body must survive</p>`;
	const first = document.querySelector("p.first")!;
	const sentence = "Long article body sentence. ";
	first.textContent = sentence
		.repeat(Math.ceil(MAX_ADAPTATION_SOURCE_CHARACTERS / sentence.length))
		.slice(0, MAX_ADAPTATION_SOURCE_CHARACTERS);
	observe(first);
	modelOutput = { roots: [".partial"] };
	expect(await runWebAdaptation("manual")).toBe("unchanged");
	expect(settings.webAdaptation.rules).toEqual([]);
	expect(await extractedText()).toContain("Tail body must survive");
});

test("legacy matching survives lazy-loaded repeated paragraphs on the same route", async () => {
	const original = savedRule(
		{ roots: [], excludes: ["nav"], includes: [], promoteTags: [] },
		true,
	);
	settings.webAdaptation.rules = [original];
	const layoutKey = getStructureKey(document);
	expect(await extractedText()).not.toContain("Navigation links");
	const another = document.createElement("p");
	another.className = "first";
	another.textContent = "Lazy-loaded article paragraph";
	document.querySelector("main")!.append(another);
	expect(getStructureKey(document)).toBe(layoutKey);
	expect(getLegacyStructureKey(document)).not.toBe(original.structureKey);
	expect(await extractedText()).not.toContain("Navigation links");
	expect(await runWebAdaptation("manual")).toBe("updated");
	expect(settings.webAdaptation.rules[0].id).toBe(original.id);
});

test("an automatic rule is rechecked after cooldown and then respects the next cooldown", async () => {
	settings.webAdaptation.autoEnabled = true;
	settings.webAdaptation.rules = [
		savedRule({ roots: [], excludes: ["nav"], includes: [], promoteTags: [] }),
	];
	expect(await runWebAdaptation("automatic")).toBe("updated");
	modelOutput = { excludes: ["p.first"] };
	expect(await runWebAdaptation("automatic")).toBe("unchanged");
	expect(settings.webAdaptation.rules[0].patch).toEqual({
		roots: [],
		excludes: ["nav"],
		includes: ["p.recovered"],
		promoteTags: [],
	});
});

test("automation switched off during the model request cannot persist its trial", async () => {
	settings.webAdaptation.autoEnabled = true;
	onModelRequest = () => {
		settings.webAdaptation.autoEnabled = false;
	};
	expect(await runWebAdaptation("automatic")).toBe("stale");
	expect(settings.webAdaptation.rules).toEqual([]);
	expect(stored).toEqual({});
});

test("an explicit removal must name a saved exclusion without also re-adding it", async () => {
	modelOutput = { removeExcludes: ["p.recovered"] };
	expect(await runWebAdaptation("manual")).toBe("failed");
	const original = savedRule({
		roots: [],
		excludes: ["p.recovered"],
		includes: [],
		promoteTags: [],
	});
	settings.webAdaptation.rules = [original];
	modelOutput = { excludes: ["p.recovered"], removeExcludes: ["p.recovered"] };
	expect(await runWebAdaptation("manual")).toBe("failed");
	expect(settings.webAdaptation.rules).toEqual([original]);
});
