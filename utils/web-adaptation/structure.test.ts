import { expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import "../test/dom-setup";
import { DATA_CONTAINER } from "~/utils/constants";
import {
	getLastStructureIdentity,
	getLegacyStructureKey,
	getStructureKey,
	setLastStructureKey,
	stableId,
} from "./structure";

test("structure key follows layout, not article text or injected translations", () => {
	const { document: isolated } = parseHTML("<html><body></body></html>");
	const main = isolated.createElement("main");
	main.className = "article-content";
	const paragraph = isolated.createElement("p");
	paragraph.textContent = "First version of the text.";
	main.append(paragraph);
	isolated.body.append(main);
	const initial = getStructureKey(isolated);

	paragraph.textContent = "The text changed without a layout change.";
	const translation = isolated.createElement("div");
	translation.setAttribute(DATA_CONTAINER, "");
	translation.innerHTML = "<span>Translated text</span>";
	main.append(translation);
	expect(getStructureKey(isolated)).toBe(initial);

	const aside = isolated.createElement("aside");
	aside.className = "related-links";
	main.append(aside);
	expect(getStructureKey(isolated)).not.toBe(initial);
});

test("dynamic-looking IDs are omitted from page snapshots", () => {
	const element = document.createElement("div");
	element.id = "user-a1b2c3d4e5f6";
	expect(stableId(element)).toBeUndefined();
	element.id = "article-body";
	expect(stableId(element)).toBe("article-body");
});

test("one article template keeps its key across paragraph counts and inline styles", () => {
	const page = (body: string) =>
		parseHTML(`<html><body>
		<main class="content"><article class="post"><h1>Title</h1>${body}</article>
		<aside class="related-links">Related</aside></main>
	</body></html>`).document;
	const short = page(
		"<p>First <a>link</a> with <strong>emphasis</strong>.</p>",
	);
	const varied = page(
		"<p>Other <em>emphasis</em>.</p><p>Another paragraph.</p>",
	);
	// Repeat beyond the old 500-element traversal limit: repetitions must not
	// push the trailing related-content structure out of the new fingerprint.
	const long = page("<p>Repeated body paragraph.</p>".repeat(500 + 1));
	expect(getStructureKey(varied)).toBe(getStructureKey(short));
	expect(getStructureKey(long)).toBe(getStructureKey(short));
	expect(getLegacyStructureKey(varied)).not.toBe(getLegacyStructureKey(short));
});

test("article and list templates and different nesting remain isolated", () => {
	const key = (html: string) =>
		getStructureKey(parseHTML(`<html><body>${html}</body></html>`).document);
	expect(key("<main><article><p>Body</p></article></main>")).not.toBe(
		key("<main><ul><li>List item</li></ul></main>"),
	);
	expect(
		key("<main><div><section>Text</section></div><p>Body</p></main>"),
	).not.toBe(key("<main><div><section>Text</section><p>Body</p></div></main>"));
});

test("CSS class ordering cannot change a layout fingerprint", () => {
	const key = (classes: string) =>
		getStructureKey(
			parseHTML(
				`<html><body><main class="${classes}"><p>Text</p></main></body></html>`,
			).document,
		);
	expect(key("content layout reader article")).toBe(
		key("article reader layout content"),
	);
});

test("a cached legacy identity is scoped to its pathname", () => {
	setLastStructureKey(document, "layout:abc12345", "/article/one", "abc12345");
	expect(getLastStructureIdentity(document, "/article/one")?.legacyKey).toBe(
		"abc12345",
	);
	expect(getLastStructureIdentity(document, "/article/other")).toBeUndefined();
});

test("MDN reference bodies and an optional linked TOC do not split one layout", () => {
	// Structural containers observed in Array/String reference HTML on 2026-10-10.
	// Filler content avoids retaining page text in the regression fixture.
	const page = (toc: string, content: string) =>
		parseHTML(`<html><body>
		<main class="layout__content"><div class="layout__header reference-layout__header"><h1>Title</h1></div>
		${toc}<div class="layout__body reference-layout__body">${content}</div></main>
	</body></html>`).document;
	const array = page(
		'<aside class="layout__right-sidebar reference-layout__toc"><a>Contents</a></aside>',
		'<section class="content-section"><p>Body</p><ol><li>Item</li></ol><figure class="table-container"><table><tr><td>Cell</td></tr></table></figure><div class="note notecard"><p>Note</p></div></section>',
	);
	const string = page(
		"",
		'<section class="content-section"><p>Other body</p><h4>Heading</h4></section>',
	);
	// The full Array reference also has compatibility details absent from map().
	const compatibilityDetails = array.createElement("details");
	compatibilityDetails.innerHTML =
		'<div class="extra"><ul><li>Compatibility detail</li></ul></div>';
	array
		.querySelector(".reference-layout__header")
		?.append(compatibilityDetails);
	expect(getLegacyStructureKey(array)).not.toBe(getLegacyStructureKey(string));
	expect(getStructureKey(array)).toBe(getStructureKey(string));
});

test("Wikipedia language menus and article-specific markup do not define the template", () => {
	// MediaWiki/Vector container names observed in public entry HTML on 2026-10-10.
	const page = (languages: string, body: string) =>
		parseHTML(`<html><body><main class="mw-body">
		<header class="mw-body-header"><ul>${languages}</ul></header>
		<div class="mw-body-content"><div class="mw-parser-output">${body}</div></div>
	</main></body></html>`).document;
	const array = page(
		'<li class="interlanguage-link interwiki-bg mw-list-item">Language</li>',
		'<table class="infobox"><tr><td>Box</td></tr></table><p>Body</p>',
	);
	const list = page(
		'<li class="interlanguage-link interwiki-bn mw-list-item">Other language</li><li>Language</li>',
		"<figure><p>Caption</p></figure><p>Other body</p><ul><li>Item</li></ul>",
	);
	expect(getLegacyStructureKey(array)).not.toBe(getLegacyStructureKey(list));
	expect(getStructureKey(array)).toBe(getStructureKey(list));
});

test("article body boundaries still preserve their surrounding layout and container type", () => {
	const key = (html: string) =>
		getStructureKey(parseHTML(`<html><body>${html}</body></html>`).document);
	expect(key('<main><article class="post"><p>Body</p></article></main>')).toBe(
		key(
			'<main><article class="post"><table><tr><td>Body</td></tr></table></article></main>',
		),
	);
	expect(
		key('<main><article class="post"><p>Body</p></article></main>'),
	).not.toBe(
		key('<main><article class="listing"><p>Body</p></article></main>'),
	);
	expect(
		key('<main><article class="post"><p>Body</p></article></main>'),
	).not.toBe(
		key(
			'<main><section><article class="post"><p>Body</p></article></section></main>',
		),
	);
});
