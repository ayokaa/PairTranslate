import { describe, expect, test } from "bun:test";
import "../test/dom-setup";
import { getMarkdownFromSection } from "~/utils/markdown";
import { domListener } from "~/utils/parser/base";
import type { Options } from "~/utils/parser/types";
import { applyAdaptationPatch } from "./apply";

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
				<p>Second useful paragraph.</p>
			</main>
		`;
		document.body.append(shell);
		const baseOptions: Options = { roots: [shell] };
		const baseline = await textSections(baseOptions);
		expect(baseline).toContain("Navigation text");
		expect(baseline).toContain("Share this page now.");

		const adapted = await textSections(
			applyAdaptationPatch(
				baseOptions,
				{
					roots: ["main.adaptation-test-main"],
					excludes: [".adaptation-test-share"],
					promoteTags: [],
				},
				document,
			),
		);
		expect(adapted).toEqual([
			"First useful paragraph.",
			"Second useful paragraph.",
		]);
		shell.remove();
	});

	test("ignores an invalid persisted patch", () => {
		const options: Options = { roots: [document.body] };
		expect(
			applyAdaptationPatch(
				options,
				{ roots: [], excludes: ["body"], promoteTags: [] },
				document,
			),
		).toBe(options);
	});
});
