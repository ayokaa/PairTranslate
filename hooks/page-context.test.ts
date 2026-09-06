import { beforeAll, describe, expect, test } from "bun:test";
import "../utils/test/dom-setup";
import { ensurePageContext } from "./page-context";

// extractPageContent needs window.getComputedStyle and window.rpc; provide
// minimal stubs over the linkedom document.
beforeAll(() => {
	const article = document.createElement("article");
	article.textContent = "A".repeat(500);
	document.body.append(article);

	(globalThis as unknown as { window: unknown }).window = {
		getComputedStyle: () => ({ display: "", visibility: "", opacity: "1" }),
		location: { href: "https://example.com/page" },
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
