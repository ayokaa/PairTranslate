import { describe, expect, test } from "bun:test";
import "../test/dom-setup";
import { getMarkdownFromSection } from "../markdown";
import { domListener } from "./base";
import type { DOMSection, Options } from "./types";

const collectSections = async (
	root: Element,
	expected: number,
	options: Options = {},
) => {
	const controller = new AbortController();
	const sections: DOMSection[] = [];

	for await (const section of domListener({
		...options,
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

		const sections = await collectSections(paragraph, 1, {
			promoteTextTags: ["P"],
		});

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

	test("does not promote Hacker News title cells over their links", async () => {
		const root = document.createElement("table");
		const row = document.createElement("tr");
		const titleCell = document.createElement("td");
		const titleLine = document.createElement("span");
		const link = document.createElement("a");
		link.href = "https://example.com/story";
		link.textContent = "A story title";
		titleLine.className = "titleline";
		titleLine.append(link);
		titleCell.className = "title";
		titleCell.append(titleLine);
		row.append(titleCell);
		root.append(row);
		document.body.append(root);

		const sections = await collectSections(root, 1);

		expect(sections).toHaveLength(1);
		expect(sections[0][0]).toBe(link.firstChild as Node);
		expect(getMarkdownFromSection(sections[0])).toBe("A story title");
	});

	test("skips numeric table cells containing Unicode symbols", async () => {
		const root = document.createElement("table");
		const row = document.createElement("tr");
		for (const text of ["Benchmark", "56.6%", "61.1 ± 0.79", "–"]) {
			const cell = document.createElement("td");
			cell.textContent = text;
			row.append(cell);
		}
		root.append(row);
		document.body.append(root);

		const sections = await collectSections(root, 1);

		expect(sections).toHaveLength(1);
		expect(getMarkdownFromSection(sections[0])).toBe("Benchmark");
	});

	test("does not promote layout ancestors that only contain deep math", async () => {
		// Quarto-like shell: outer page-columns div wraps <main> and a formula
		// lives deep inside a paragraph. The outer div must not become one
		// giant section (which would inject the translation after </main>).
		const shell = document.createElement("div");
		shell.id = "quarto-content";
		shell.className = "quarto-container page-columns";

		const main = document.createElement("main");
		main.id = "quarto-document-content";

		const p1 = document.createElement("p");
		p1.textContent = "First body paragraph.";

		const p2 = document.createElement("p");
		p2.append(document.createTextNode("Has formula "));
		const math = document.createElement("span");
		math.className = "math inline";
		math.textContent = "x = 1";
		p2.append(math);
		p2.append(document.createTextNode(" here."));

		const p3 = document.createElement("p");
		p3.textContent = "Third paragraph.";

		main.append(p1, p2, p3);
		shell.append(main);
		document.body.append(shell);

		const sections = await collectSections(shell, 3);
		const texts = sections.map(getMarkdownFromSection);

		expect(sections).toHaveLength(3);
		expect(texts[0]).toBe("First body paragraph.");
		expect(texts[1]).toContain("Has formula");
		expect(texts[1]).toContain("here.");
		expect(texts[2]).toBe("Third paragraph.");
		// No single section spanning the whole article.
		expect(texts.some((t) => t.includes("First") && t.includes("Third"))).toBe(
			false,
		);
	});

	test("still promotes leaf containers that only wrap math", async () => {
		const paragraph = document.createElement("p");
		const math = document.createElement("span");
		math.className = "math inline";
		math.textContent = "E = mc^2";
		paragraph.append(math);
		document.body.append(paragraph);

		const sections = await collectSections(paragraph, 1);

		expect(sections).toHaveLength(1);
		expect(getMarkdownFromSection(sections[0])).toContain("E = mc^2");
	});

	test("splits at main when a parent text container wraps the document body", async () => {
		// Defense in depth: even if a parent were treated as a text container,
		// MAIN must be a block boundary so paragraphs inside stay separate.
		const shell = document.createElement("div");
		shell.append(document.createTextNode("Lead-in. "));

		const main = document.createElement("main");
		const p1 = document.createElement("p");
		p1.textContent = "Inside main one.";
		const p2 = document.createElement("p");
		p2.textContent = "Inside main two.";
		main.append(p1, p2);
		shell.append(main);
		document.body.append(shell);

		const sections = await collectSections(shell, 3);
		const texts = sections.map((s) => getMarkdownFromSection(s).trim());

		expect(texts).toEqual([
			"Lead-in.",
			"Inside main one.",
			"Inside main two.",
		]);
	});
});
