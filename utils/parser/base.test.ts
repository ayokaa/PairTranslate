import { describe, expect, test } from "bun:test";
import "../test/dom-setup";
import { getMarkdownFromSection } from "../markdown";
import { domListener } from "./base";
import type { DOMSection } from "./types";

const collectSections = async (root: Element, expected: number) => {
	const controller = new AbortController();
	const sections: DOMSection[] = [];

	for await (const section of domListener({
		roots: [root],
		listenNew: false,
		filterInteractive: false,
		signal: controller.signal,
	})) {
		sections.push(section);
		if (sections.length === expected) controller.abort();
	}

	return sections;
};

describe("domListener", () => {
	test("keeps word-level inline spans in one paragraph", async () => {
		const paragraph = document.createElement("p");
		for (const [index, word] of ["Who", "can", "punch", "reality"].entries()) {
			const span = document.createElement("span");
			span.className = "hl-word";
			span.dataset.i = String(index);
			span.textContent = word;
			paragraph.append(span);
			if (index < 3) paragraph.append(document.createTextNode(" "));
		}
		document.body.append(paragraph);

		const sections = await collectSections(paragraph, 1);

		expect(sections).toHaveLength(1);
		expect(getMarkdownFromSection(sections[0])).toBe("Who can punch reality");
	});

	test("still splits paragraphs at block descendants", async () => {
		const root = document.createElement("div");
		for (const text of ["First paragraph.", "Second paragraph."]) {
			const paragraph = document.createElement("p");
			paragraph.textContent = text;
			root.append(paragraph);
		}
		document.body.append(root);

		const sections = await collectSections(root, 2);

		expect(sections).toHaveLength(2);
		expect(sections.map(getMarkdownFromSection)).toEqual([
			"First paragraph.",
			"Second paragraph.",
		]);
	});
});
