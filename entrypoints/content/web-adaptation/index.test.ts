import { expect, mock, test } from "bun:test";
import "~/utils/test/dom-setup";

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
}));
mock.module("~/utils/page-context", () => ({ getPageContext: () => ({}) }));
mock.module("./snapshot", () => ({
	buildPageSnapshot: () => ({
		hostname: "example.com",
		pathname: "/article/one",
		structureKey: "abc12345",
		outline: [{ depth: 0, tag: "main", classes: ["article"] }],
		pairs: [
			{
				path: "main.article > p",
				source: "Article paragraph one",
				translation: "译文一",
			},
			{
				path: "main.article > p",
				source: "Article paragraph two",
				translation: "译文二",
			},
		],
	}),
}));

const nav = document.createElement("nav");
const navText = document.createElement("p");
navText.textContent = "Navigation controls";
nav.append(navText);
const main = document.createElement("main");
main.className = "article";
const articleText = document.createElement("p");
articleText.textContent = "Useful article paragraph";
main.append(articleText);
document.body.append(nav, main);

mock.module("../parser", () => ({
	getDomListener: async (
		_domain: string,
		_options: unknown,
		_rules: unknown,
		patch?: unknown,
	) =>
		(async function* () {
			for (const element of patch ? [articleText] : [navText, articleText]) {
				const node = element.firstChild as Node;
				yield [node, node] as const;
			}
		})(),
}));

let sentPayload: unknown;
let committed: unknown;
Object.assign(globalThis, {
	window: {
		location: {
			protocol: "https:",
			href: "https://example.com/article/one",
			hostname: "example.com",
			pathname: "/article/one",
		},
		rpc: {
			unary: async (_ctx: unknown, _config: unknown, text: string) => {
				sentPayload = JSON.parse(text);
				return {
					output: JSON.stringify({
						roots: ["main.article"],
						excludes: [],
						promoteTags: [],
					}),
				};
			},
			commitWebAdaptation: async (proposal: unknown) => {
				committed = proposal;
				return "added";
			},
		},
	},
});

const { runWebAdaptation } = await import("./index");

test("manual analysis sends bounded structure and translations, then commits an improved rule", async () => {
	expect(await runWebAdaptation("manual")).toBe("added");
	expect(sentPayload).toEqual({
		outline: [{ depth: 0, tag: "main", classes: ["article"] }],
		pairs: [
			{
				path: "main.article > p",
				source: "Article paragraph one",
				translation: "译文一",
			},
			{
				path: "main.article > p",
				source: "Article paragraph two",
				translation: "译文二",
			},
		],
	});
	expect(committed).toEqual({
		hostname: "example.com",
		pathname: "/article/one",
		structureKey: "abc12345",
		source: "manual",
		patch: { roots: ["main.article"], excludes: [], promoteTags: [] },
	});
});
