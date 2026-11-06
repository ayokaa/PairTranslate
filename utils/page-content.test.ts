import { afterEach, expect, test } from "bun:test";
import "./test/dom-setup";
import { isProtectedPageContent, isVisiblePageContent } from "./page-content";

const view = document.defaultView!;
const originalStyle = view.getComputedStyle;
afterEach(() => {
	view.getComputedStyle = originalStyle;
	document.body.innerHTML = "";
});

// Attribute-only tests run without a CSS engine; presentation tests supply
// computed styles rather than treating linkedom's missing layout as invisible.
function withStyles(styles: Map<Element, Partial<CSSStyleDeclaration>>) {
	view.getComputedStyle = ((element: Element) => ({
		display: "block",
		visibility: "visible",
		opacity: "1",
		clip: "auto",
		position: "static",
		contentVisibility: "visible",
		...styles.get(element),
	})) as typeof view.getComputedStyle;
}

test("accessibility-hidden read-only text is not an editor boundary", () => {
	document.body.innerHTML =
		'<div aria-hidden="true" contenteditable="FALSE"><p>Prose</p></div>';
	const paragraph = document.querySelector("p")!;
	expect(isProtectedPageContent(paragraph)).toBe(false);
	paragraph.parentElement!.setAttribute("contenteditable", "true");
	expect(isProtectedPageContent(paragraph)).toBe(true);
});

test("presentation checks distinguish real CSS hiding from display:contents", () => {
	document.body.innerHTML = "<div><p>Prose</p></div>";
	const parent = document.querySelector("div")!;
	const paragraph = document.querySelector("p")!;
	for (const style of [
		{ display: "none" },
		{ opacity: "0" },
		{ contentVisibility: "hidden" },
		{ position: "absolute", clip: "rect(0px, 0px, 0px, 0px)" },
	]) {
		withStyles(new Map([[parent, style]]));
		expect(isVisiblePageContent(paragraph)).toBe(false);
	}
	withStyles(new Map([[parent, { display: "contents" }]]));
	expect(isVisiblePageContent(paragraph)).toBe(true);
});

test("visibility overrides remain possible but hidden attributes stay protected", () => {
	document.body.innerHTML = "<div><p>Visible override</p></div>";
	const parent = document.querySelector("div")!;
	const paragraph = document.querySelector("p")!;
	withStyles(
		new Map([
			[parent, { visibility: "hidden" }],
			[paragraph, { visibility: "visible" }],
		]),
	);
	expect(isVisiblePageContent(parent)).toBe(false);
	expect(isVisiblePageContent(paragraph)).toBe(true);
	parent.setAttribute("hidden", "");
	expect(isVisiblePageContent(paragraph)).toBe(false);
});
