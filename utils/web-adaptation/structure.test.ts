import { expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import "../test/dom-setup";
import { DATA_CONTAINER } from "~/utils/constants";
import { getStructureKey, stableId } from "./structure";

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
