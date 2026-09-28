import { describe, expect, test } from "bun:test";
import "../test/dom-setup";
import { getMarkdownFromSection } from "~/utils/markdown";
import { domListener } from "~/utils/parser/base";
import type { Options } from "~/utils/parser/types";
import { applyAdaptationPatch, hasStaleAdaptationRoots } from "./apply";

async function textSections(options: Options): Promise<string[]> {
	const result: string[] = [];
	for await (const section of domListener({
		...options,
		listenNew: false,
		filterInteractive: false,
	})) {
		result.push(getMarkdownFromSection(section));
	}
	return result;
}

describe("applyAdaptationPatch", () => {
	test("limits translation to content roots and removes suggested noise", async () => {
		const shell = document.createElement("div");
		shell.innerHTML = `
			<nav><p>Navigation text</p></nav>
			<main class="adaptation-test-main">
				<p>First useful paragraph.</p>
				<div class="adaptation-test-share"><p>Share this page now.</p></div>
				<div class="adaptation-test-site-exclude">Ignored wrapper text.
					<p class="adaptation-test-reinclude">Useful recovered paragraph.</p>
					<p class="notranslate">Explicitly opted out.</p>
				</div>
				<p>Second useful paragraph.</p>
			</main>
		`;
		document.body.append(shell);
		const baseOptions: Options = {
			roots: [shell],
			excludedSelectors: [".adaptation-test-site-exclude"],
		};
		const baseline = await textSections(baseOptions);
		expect(baseline).toContain("Navigation text");
		expect(baseline).toContain("Share this page now.");

		const adapted = await textSections(
			applyAdaptationPatch(
				baseOptions,
				{
					roots: ["main.adaptation-test-main"],
					excludes: [".adaptation-test-share"],
					includes: [".adaptation-test-reinclude"],
					promoteTags: [],
				},
				document,
			),
		);
		expect(adapted).toEqual([
			"First useful paragraph.",
			"Useful recovered paragraph.",
			"Second useful paragraph.",
		]);
		shell.remove();
	});

	test("included selectors do not override hard exclusions or explicit rule exclusions", async () => {
		const root = document.createElement("div");
		root.innerHTML = `
			<div class="site-wrapper">
				<p class="site-filter">Recover this text.</p>
				<p hidden>Do not recover hidden text.</p>
				<p class="notranslate">Do not recover this text.</p>
			</div>
			<p class="adaptation-exclude">Keep this excluded.</p>
		`;
		document.body.append(root);
		const adapted = await textSections(
			applyAdaptationPatch(
				{ roots: [root], excludedSelectors: [".site-wrapper"] },
				{
					roots: [],
					excludes: [".adaptation-exclude"],
					includes: [".site-filter"],
					promoteTags: [],
				},
				document,
			),
		);
		expect(adapted).toEqual(["Recover this text."]);
		root.remove();
	});

	test("ignores an invalid persisted patch", () => {
		const options: Options = { roots: [document.body] };
		expect(
			applyAdaptationPatch(
				options,
				{ roots: [], excludes: ["body"], includes: [], promoteTags: [] },
				document,
			),
		).toBe(options);
	});

	test("keeps roots and exclusions when an optional include disappears", () => {
		const root = document.createElement("main");
		root.className = "runtime-main";
		root.innerHTML = `
			<p class="runtime-content">Visible body text</p>
			<div class="runtime-noise">Noise</div>
		`;
		document.body.append(root);
		const options: Options = { roots: [document.body] };

		const adapted = applyAdaptationPatch(
			options,
			{
				roots: ["main.runtime-main"],
				excludes: [".runtime-noise"],
				includes: [".runtime-removed"],
				promoteTags: [],
			},
			document,
		);

		expect(adapted.roots).toEqual([root]);
		expect(adapted.protectedExcludedSelectors).toEqual([".runtime-noise"]);
		expect(adapted.includedSelectors).toEqual([".runtime-removed"]);
		root.remove();
	});

	test("applies saved include and exclude selectors to later DOM nodes", async () => {
		const root = document.createElement("main");
		root.innerHTML = "<p>Initial body text</p>";
		document.body.append(root);
		const options = applyAdaptationPatch(
			{
				roots: [root],
				excludedSelectors: [".runtime-site-filter"],
			},
			{
				roots: [],
				excludes: [".runtime-late-noise"],
				includes: [".runtime-late-include"],
				promoteTags: [],
			},
			document,
		);

		const lateNoise = document.createElement("p");
		lateNoise.className = "runtime-late-noise";
		lateNoise.textContent = "Do not translate late noise";
		const lateInclude = document.createElement("p");
		lateInclude.className = "runtime-site-filter runtime-late-include";
		lateInclude.textContent = "Recover late included text";
		root.append(lateNoise, lateInclude);

		try {
			expect(await textSections(options)).toEqual([
				"Initial body text",
				"Recover late included text",
			]);
		} finally {
			root.remove();
		}
	});

	test("does not reinclude a dynamic target with protected code descendants", async () => {
		const root = document.createElement("main");
		document.body.append(root);
		const options = applyAdaptationPatch(
			{
				roots: [root],
				excludedSelectors: [".runtime-site-filter"],
			},
			{
				roots: [],
				excludes: [],
				includes: [".runtime-late-code-include"],
				promoteTags: [],
			},
			document,
		);
		const target = document.createElement("p");
		target.className = "runtime-site-filter runtime-late-code-include";
		target.append(document.createTextNode("正文文本 "));
		const code = document.createElement("code");
		code.textContent = "secret source code";
		target.append(code, document.createTextNode(" 后文"));
		root.append(target);

		try {
			const translated = (await textSections(options)).join("\n");
			expect(translated).toBe("");
		} finally {
			root.remove();
		}
	});

	test("falls back to the default scan when saved roots are missing", async () => {
		const root = document.createElement("main");
		root.innerHTML = "<p>Root scope must stay closed</p>";
		document.body.append(root);
		const patch = {
			roots: ["main.runtime-missing-root"],
			excludes: [],
			includes: [],
			promoteTags: [],
		};
		const adapted = applyAdaptationPatch({}, patch, document);
		const sections: string[] = [];
		for await (const section of domListener({
			...adapted,
			listenNew: false,
			filterInteractive: false,
		})) {
			sections.push(getMarkdownFromSection(section));
		}

		// A stale rule must not stop translation: scanning falls back to the
		// default page scope and the rule itself is dropped by getDomListener.
		expect(adapted.roots).toBeUndefined();
		expect(sections).toContain("Root scope must stay closed");
		expect(hasStaleAdaptationRoots(patch, document)).toBe(true);
		root.remove();
	});

	test("reports a patch without declared roots as never stale", () => {
		expect(
			hasStaleAdaptationRoots(
				{ roots: [], excludes: ["nav"], includes: [], promoteTags: [] },
				document,
			),
		).toBe(false);
		expect(hasStaleAdaptationRoots(undefined, document)).toBe(false);
	});

	test("reports a patch with matching roots as fresh", () => {
		const root = document.createElement("main");
		root.className = "stale-check";
		document.body.append(root);
		try {
			expect(
				hasStaleAdaptationRoots(
					{
						roots: ["main.stale-check"],
						excludes: [],
						includes: [],
						promoteTags: [],
					},
					document,
				),
			).toBe(false);
		} finally {
			root.remove();
		}
	});
});

test("a root selector matching more than the runtime cap counts as stale", async () => {
	const shell = document.createElement("div");
	shell.innerHTML = Array.from(
		{ length: 60 },
		(_, i) => `<p class="bulk">段落 ${i}</p>`,
	).join("");
	document.body.append(shell);
	try {
		const patch = {
			roots: ["p.bulk"],
			excludes: [],
			includes: [],
			promoteTags: [],
		};

		// The runtime drops the selector (60 matches > 40), so the rule is stale
		// and must be treated the same way as one that matches nothing.
		expect(hasStaleAdaptationRoots(patch, document)).toBe(true);
		const adapted = applyAdaptationPatch({}, patch, document);
		expect(adapted.roots).toBeUndefined();
		const sections: string[] = [];
		for await (const section of domListener({
			...adapted,
			listenNew: false,
			filterInteractive: false,
		})) {
			sections.push(getMarkdownFromSection(section));
		}
		expect(sections).toContain("段落 0");
	} finally {
		shell.remove();
	}
});
