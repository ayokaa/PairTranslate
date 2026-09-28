import { expect, mock, test } from "bun:test";
import "~/utils/test/dom-setup";
import type { AdaptationRule } from "~/utils/web-adaptation/model";

const deletedRules: string[] = [];
const rules: AdaptationRule[] = [];
let parserIndex: number | null = null;

mock.module("~/utils/rpc/wxt-def", () => ({ waitRpc: async () => {} }));
mock.module("~/utils/settings/helper", () => ({
	// Keep every export: a partial mock leaks into other test files.
	getSettings: async () => ({
		webAdaptation: { autoEnabled: false, rules },
	}),
	saveSettings: async () => {},
	listenSettings: () => () => {},
	listenEnabled: () => () => {},
	getSettingsMigrationError: async () => undefined,
	clearSettingsMigrationError: async () => {},
}));

Object.assign(globalThis, {
	window: {
		location: {
			protocol: "https:",
			hostname: "example.com",
			pathname: "/article",
		},
		rpc: {
			matchParser: async () => parserIndex,
			deleteWebAdaptationRule: async (id: string) => {
				deletedRules.push(id);
				return true;
			},
		},
	},
});

const { getStructureKey } = await import("~/utils/web-adaptation/structure");
const { getDomListener } = await import("./parser");

const rule = (roots: string[], id = "3f2504e0-4f89-11d3-9a0c-0305e82c3300") =>
	({
		id,
		hostname: "example.com",
		pathPatterns: ["/article"],
		structureKey: getStructureKey(document),
		enabled: true,
		source: "automatic",
		patch: { roots, excludes: [], includes: [], promoteTags: [] },
		createdAt: 1,
		updatedAt: 1,
	}) as AdaptationRule;

async function sectionsOf(listener: AsyncGenerator<unknown>) {
	const { getMarkdownFromSection } = await import("~/utils/markdown");
	const texts: string[] = [];
	for await (const section of listener as AsyncIterable<[Node, Node]>) {
		texts.push(getMarkdownFromSection(section));
	}
	return texts;
}

test("a stale rule is dropped and the default scan is restored", async () => {
	const main = document.createElement("main");
	main.className = "current-shell";
	const paragraph = document.createElement("p");
	paragraph.textContent = "Article body text";
	main.append(paragraph);
	document.body.append(main);
	try {
		rules.length = 0;
		deletedRules.length = 0;
		rules.push(rule(["main.old-shell"]));

		const listener = await getDomListener("example.com", { listenNew: false });

		expect(await sectionsOf(listener)).toContain("Article body text");
		expect(deletedRules).toEqual(["3f2504e0-4f89-11d3-9a0c-0305e82c3300"]);
	} finally {
		main.remove();
	}
});

test("a matching rule keeps narrowing the scan and is not dropped", async () => {
	const shell = document.createElement("div");
	const outside = document.createElement("p");
	outside.textContent = "Outside text";
	const main = document.createElement("main");
	main.className = "current-shell";
	const inside = document.createElement("p");
	inside.textContent = "Inside text";
	main.append(inside);
	shell.append(outside, main);
	document.body.append(shell);
	try {
		rules.length = 0;
		deletedRules.length = 0;
		rules.push(rule(["main.current-shell"]));

		const listener = await getDomListener("example.com", { listenNew: false });
		const texts = await sectionsOf(listener);

		expect(texts).toEqual(["Inside text"]);
		expect(deletedRules).toEqual([]);
	} finally {
		shell.remove();
	}
});

test("a candidate patch bypasses the saved rule during a trial run", async () => {
	const main = document.createElement("main");
	main.className = "current-shell";
	const paragraph = document.createElement("p");
	paragraph.textContent = "Article body text";
	main.append(paragraph);
	document.body.append(main);
	try {
		rules.length = 0;
		deletedRules.length = 0;
		rules.push(rule(["main.old-shell"]));

		// The trial run applies the override only, so the stale saved rule must
		// neither narrow the candidate nor be deleted while sampling it.
		const listener = await getDomListener(
			"example.com",
			{ listenNew: false },
			rules,
			{ roots: [], excludes: [], includes: [], promoteTags: [] },
		);

		expect(await sectionsOf(listener)).toContain("Article body text");
		expect(deletedRules).toEqual([]);
	} finally {
		main.remove();
	}
});
