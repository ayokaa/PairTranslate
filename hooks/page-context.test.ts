import { beforeAll, describe, expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import "../utils/test/dom-setup";
import { ensurePageContext, usePageContext } from "./page-context";

// extractPageContent needs window.getComputedStyle and window.rpc; provide
// minimal stubs over the linkedom document.
beforeAll(() => {
	const article = document.createElement("article");
	article.textContent = "A".repeat(500);
	document.body.append(article);

	(globalThis as unknown as { window: unknown }).window = {
		getComputedStyle: () => ({ display: "", visibility: "", opacity: "1" }),
		location: { href: "https://example.com/page" },
		setInterval: () => 0,
		clearInterval: () => {},
		rpc: undefined,
	};
});

describe("page context cache", () => {
	test("same-page fragment navigation reuses the cached context", async () => {
		let calls = 0;
		(window as unknown as { rpc: unknown }).rpc = {
			unary: async () => {
				calls++;
				return { output: "page summary" };
			},
		};

		const base = await ensurePageContext({
			modelId: "model-x",
			srcLang: "en",
			dstLang: "zh",
			url: "https://example.com/page",
		});
		const viaHash = await ensurePageContext({
			modelId: "model-x",
			srcLang: "en",
			dstLang: "zh",
			url: "https://example.com/page#1-note",
		});
		const viaOtherHash = await ensurePageContext({
			modelId: "model-x",
			srcLang: "en",
			dstLang: "zh",
			url: "https://example.com/page#footnotes",
		});

		expect(base).toBe("page summary");
		expect(viaHash).toBe("page summary");
		expect(viaOtherHash).toBe("page summary");
		expect(calls).toBe(1);
	});

	test("a genuinely different URL gets its own context", async () => {
		let calls = 0;
		(window as unknown as { rpc: unknown }).rpc = {
			unary: async () => {
				calls++;
				return { output: "other summary" };
			},
		};

		const result = await ensurePageContext({
			modelId: "model-x",
			srcLang: "en",
			dstLang: "zh",
			url: "https://example.com/other",
		});

		expect(result).toBe("other summary");
		expect(calls).toBe(1);
	});
});

describe("page context generation gate", () => {
	test("captures the content while held, and only calls the model once wanted", async () => {
		let calls = 0;
		(window as unknown as { rpc: unknown }).rpc = {
			unary: async () => {
				calls++;
				return { output: "gated summary" };
			},
		};

		const [generate, setGenerate] = createSignal(false);
		let ctx: ReturnType<typeof usePageContext> | undefined;
		const dispose = createRoot((dispose) => {
			ctx = usePageContext({
				modelId: () => "model-y",
				srcLang: () => "en",
				dstLang: () => "zh",
				active: () => true,
				generate,
			});
			return dispose;
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		// Held: the content was read, the model was not called.
		expect(calls).toBe(0);
		expect(ctx).toBeDefined();
		expect(ctx?.ready()).toBe(false);

		setGenerate(true);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(calls).toBe(1);
		expect(ctx?.ready()).toBe(true);

		dispose();
	});
});
