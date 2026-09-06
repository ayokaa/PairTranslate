import { describe, expect, test } from "bun:test";
import "./test/dom-setup";
import { getMarkdownFromNode } from "./markdown";

const build = (html: string): HTMLElement => {
	const container = document.createElement("div");
	container.innerHTML = html;
	return container;
};

describe("markdown conversion of links", () => {
	test("external links keep markdown link syntax", () => {
		const el = build(
			'<p>see <a href="https://example.com/docs">the docs</a> now</p>',
		);
		expect(getMarkdownFromNode(el)).toContain(
			"[the docs](https://example.com/docs)",
		);
	});

	test("footnote reference links emit only their text", () => {
		// zachkehs.com style: the visible [n] marker is CSS-generated, the
		// link text is sentence content.
		const el = build(
			'<p>owned code related to <a role="doc-noteref" href="#1-note" id="1-ref">processing orders</a>. On the surface</p>',
		);
		const md = getMarkdownFromNode(el);
		expect(md).toContain("related to processing orders. On the surface");
		expect(md).not.toContain("#1-note");
	});

	test("sup-wrapped numeric footnote refs keep the marker text only", () => {
		// Wikipedia / markdown-it style: the marker itself is the link text.
		const el = build(
			'<p>a claim<sup class="reference"><a href="#cite_note-1">[1]</a></sup> followed</p>',
		);
		const md = getMarkdownFromNode(el);
		expect(md).toContain("a claim[1] followed");
		expect(md).not.toContain("cite_note");
	});

	test("footnote backlinks emit only their symbol", () => {
		const el = build(
			'<li>note text <a role="doc-backlink" href="#1-ref">↩</a></li>',
		);
		const md = getMarkdownFromNode(el);
		expect(md).toContain("note text ↩");
		expect(md).not.toContain("#1-ref");
	});

	test("links without href emit only their text", () => {
		const el = build("<p>an <a>anchor point</a> here</p>");
		const md = getMarkdownFromNode(el);
		expect(md).toContain("an anchor point here");
		expect(md).not.toContain("](");
	});
});
