import { expect, mock, test } from "bun:test";

mock.module("~/utils/animate", () => ({ animate: () => Promise.resolve() }));
mock.module("~/utils/i18n", () => ({
	i18n: { t: (key: string) => key },
	t: (key: string) => key,
}));
mock.module("~/utils/page-context", () => ({ getPageContext: () => ({}) }));
mock.module("~/utils/language-detection", () => ({
	detectSourceLanguage: async () => undefined,
}));
mock.module("~/hooks/progress-indicator", () => ({
	mightUseProgressIndicator: () => undefined,
}));
mock.module("~/hooks/page-context", () => ({
	usePageContext: () => ({ text: () => undefined, ready: () => true }),
	getCachedPageContext: () => undefined,
}));

const settings = {
	translate: {
		inTextTranslateModel: "m1",
		sourceLang: "auto",
		targetLang: "zh-CN",
		translationMode: "append",
		inTextTranslateIconEnabled: true,
		inTextTranslationActionsEnabled: true,
	},
	services: {},
	queue: { maxBatchSize: 10, maxTokensPerBatch: 10000 },
};
mock.module("~/hooks/settings", () => ({ useSettings: () => ({ settings }) }));
mock.module("~/hooks/website-rule", () => ({ useWebsiteRule: () => ({}) }));

const requests: string[][] = [];
Object.assign(globalThis, {
	window: {
		innerWidth: 1024,
		innerHeight: 768,
		document,
		rpc: {
			unary: (_ctx: unknown, _opts: unknown, texts: string[]) => {
				requests.push(texts);
				return Promise.resolve(texts.map((text) => `[${text}]`));
			},
		},
		addEventListener: () => {},
		removeEventListener: () => {},
	},
	requestIdleCallback: (cb: () => void) => setTimeout(cb, 0),
	cancelIdleCallback: (id: number) => clearTimeout(id),
	requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
});

const { render } = await import("solid-js/web");
const { createSignal } = await import("solid-js");
const { BatchInTextTranslation } = await import("./InTextTranslate");

// The batching effect debounces through setTimeout -> idle -> animation frame.
const settle = () => new Promise((resolve) => setTimeout(resolve, 320));

const addParagraph = (text: string) => {
	const paragraph = document.createElement("p");
	const node = document.createTextNode(text);
	paragraph.appendChild(node);
	document.body.appendChild(paragraph);
	return { paragraph, section: [node, node] as const };
};

test("a section leaving the viewport does not re-translate the batch", async () => {
	const host = document.createElement("div");
	document.body.appendChild(host);

	const alpha = addParagraph("Alpha paragraph");
	const beta = addParagraph("Beta paragraph");
	const [sections, setSections] = createSignal(
		new Set<readonly [Node, Node]>(),
		{ equals: false },
	);

	render(() => <BatchInTextTranslation sections={sections()} />, host);
	await settle();

	setSections((prev) => {
		prev.add(alpha.section);
		prev.add(beta.section);
		return prev;
	});
	await settle();

	expect(requests).toEqual([["Alpha paragraph", "Beta paragraph"]]);
	expect(alpha.paragraph.textContent).toContain("[Alpha paragraph]");

	setSections((prev) => {
		prev.delete(beta.section);
		return prev;
	});
	await settle();

	// Beta's rendering is gone, Alpha keeps its translation, nothing was re-sent.
	expect(beta.paragraph.textContent).toBe("Beta paragraph");
	expect(alpha.paragraph.textContent).toContain("[Alpha paragraph]");
	expect(requests).toEqual([["Alpha paragraph", "Beta paragraph"]]);

	// A newly visible section still gets translated, in its own batch.
	const gamma = addParagraph("Gamma paragraph");
	setSections((prev) => {
		prev.add(gamma.section);
		return prev;
	});
	await settle();

	expect(requests).toEqual([
		["Alpha paragraph", "Beta paragraph"],
		["Gamma paragraph"],
	]);
});
