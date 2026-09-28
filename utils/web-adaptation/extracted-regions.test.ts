import { expect, test } from "bun:test";
import "~/utils/test/dom-setup";
import { createExtractedRegionMatcher } from "./extracted-regions";

test("recognizes one site paragraph split across descendant samples", () => {
	const paragraph = document.createElement("p");
	paragraph.innerHTML = "<span>Complete source</span><span> paragraph.</span>";
	const candidate = { text: "Complete source paragraph.", element: paragraph };
	const extracted = [...paragraph.children].map((element) => ({
		text: element.textContent ?? "",
		element,
	}));

	expect(createExtractedRegionMatcher(extracted)(candidate)).toBe(true);
});

test("recognizes CJK text split across descendant samples without spaces", () => {
	const paragraph = document.createElement("p");
	paragraph.innerHTML = "<span>你好</span><span>世界</span>";
	const candidate = { text: "你好世界", element: paragraph };
	const extracted = [...paragraph.children].map((element) => ({
		text: element.textContent ?? "",
		element,
	}));

	expect(createExtractedRegionMatcher(extracted)(candidate)).toBe(true);
});

test("does not match identical text from an unrelated DOM region", () => {
	const candidateElement = document.createElement("p");
	const extractedElement = document.createElement("p");
	candidateElement.textContent = "Repeated text";
	extractedElement.textContent = "Repeated text";
	const candidate = { text: "Repeated text", element: candidateElement };

	expect(
		createExtractedRegionMatcher([
			{ text: "Repeated text", element: extractedElement },
		])(candidate),
	).toBe(false);
});
