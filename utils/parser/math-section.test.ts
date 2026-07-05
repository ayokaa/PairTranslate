import { describe, expect, test } from "bun:test";
import { isDisplayOnlySection } from "./math-section";
import type { DOMSection } from "./types";

describe("isDisplayOnlySection", () => {
	test("returns false for a plain text paragraph", () => {
		const section = createParagraph("Just some text.");
		expect(isDisplayOnlySection(section)).toBe(false);
	});

	test("returns false for inline math mixed with text", () => {
		const section = createParagraph("Today is the");
		const math = document.createElement("span");
		math.className = "math inline";
		math.textContent = "\\(\\tau\\)";
		const after = document.createTextNode(" day.");
		const container = document.createElement("p");
		container.append(section[0], math, after);
		expect(isDisplayOnlySection([math, math])).toBe(false);
	});

	test("returns true for a display math only section", () => {
		const math = document.createElement("span");
		math.className = "math display";
		math.textContent = "\\[\\sum_{n=1}^{\\infty}\\]";
		expect(isDisplayOnlySection([math, math])).toBe(true);
	});

	test("returns true for display math wrapped in $$", () => {
		const math = document.createElement("span");
		math.className = "math display";
		math.textContent = "$$\\sum_{n=1}^{\\infty}$$";
		expect(isDisplayOnlySection([math, math])).toBe(true);
	});

	test("returns false for an empty section", () => {
		const span = document.createElement("span");
		span.textContent = "";
		expect(isDisplayOnlySection([span, span])).toBe(false);
	});

	test("ignores zero-width spaces around display math", () => {
		const math = document.createElement("span");
		math.className = "math display";
		math.textContent = "\u200B\n$$\\pi^2 = 6\\zeta(2)\n$$\u200B";
		expect(isDisplayOnlySection([math, math])).toBe(true);
	});
});

function createParagraph(text: string): DOMSection {
	const p = document.createElement("p");
	p.textContent = text;
	return [p.firstChild as Node, p.lastChild as Node];
}
