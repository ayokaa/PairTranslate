import { describe, expect, test } from "bun:test";
import { DATA_CONTAINER, DATA_HIDE, DATA_TRANSLATED } from "~/utils/constants";
import "../../utils/test/dom-setup";
import { extractPageContent } from "./extract";

const LONG = "A".repeat(240);

(globalThis as unknown as { window: unknown }).window = {
	getComputedStyle: () => ({ display: "", visibility: "", opacity: "1" }),
};

const mount = (html: string) => {
	document.body.innerHTML = `<article>${html}</article>`;
};

describe("extractPageContent", () => {
	test("reads the page's own text", () => {
		mount(`<p>${LONG}</p><p>${LONG}</p>`);

		const { content, truncated } = extractPageContent();

		expect(truncated).toBe(false);
		expect(content).toBe(`${LONG}\n\n${LONG}`);
	});

	test("keeps the original of a section that was translated", () => {
		// What the in-text translation leaves behind in the default parallel
		// mode: the host carries data-pt-translated, the translation is a
		// sibling container inside it. Reading the host must still yield the
		// page's own text, and the translation must not be repeated.
		mount(
			`<p ${DATA_TRANSLATED}="">${LONG}<div ${DATA_CONTAINER}="">译文一</div></p>`,
		);

		const { content } = extractPageContent();

		expect(content).toBe(LONG);
	});

	test("reads the translation once the original is gone", () => {
		// Replace mode empties the nodes it hides, so the container is the only
		// copy of this section left in the document.
		mount(
			`<p ${DATA_TRANSLATED}=""><span ${DATA_HIDE}=""></span><div ${DATA_CONTAINER}="">剩余内容</div></p>`,
		);

		const { content } = extractPageContent();

		expect(content).toBe("剩余内容");
	});

	test("does not read the extension's own overlay", () => {
		// The overlay container is not a translation of anything on the page.
		mount(`<p>${LONG}</p><div ${DATA_CONTAINER}="">悬浮球 UI 文本</div>`);

		const { content } = extractPageContent();

		expect(content).toBe(LONG);
	});
});
