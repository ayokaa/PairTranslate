import { beforeAll, describe, expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import type { ServicesSettings } from "~/utils/settings/def";
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
	test("isolates effective effort while sharing inherited and explicit matching defaults", async () => {
		const services: ServicesSettings = {
			provider: {
				type: "llm",
				name: "Test",
				apiSpec: "openai",
				models: { model: { name: "Test", thinkingBudget: "high" } },
			},
		};
		const options = {
			model: { modelId: "model" },
			services,
			srcLang: "en",
			dstLang: "zh",
			url: "https://example.com/effort",
		};
		const received: unknown[] = [];
		(window as unknown as { rpc: unknown }).rpc = {
			unary: async (_ctx: unknown, config: unknown) => {
				received.push(config);
				return { output: `context ${received.length}` };
			},
		};
		expect(await ensurePageContext(options)).toBe("context 1");
		expect(
			await ensurePageContext({
				...options,
				model: { modelId: "model", thinkingBudget: "high" },
			}),
		).toBe("context 1");
		expect(
			await ensurePageContext({
				...options,
				model: { modelId: "model", thinkingBudget: "off" },
			}),
		).toBe("context 2");
		(
			services.provider as Extract<ServicesSettings[string], { type: "llm" }>
		).models.model.thinkingBudget = "off";
		expect(await ensurePageContext(options)).toBe("context 2");
		(
			services.provider as Extract<ServicesSettings[string], { type: "llm" }>
		).models.model.thinkingBudget = "low";
		expect(await ensurePageContext(options)).toBe("context 3");
		expect(received).toHaveLength(3);
		expect(received[1]).toMatchObject({
			modelId: "model",
			thinkingBudget: "off",
		});
	});
	test("same-page fragment navigation reuses the cached context", async () => {
		let calls = 0;
		(window as unknown as { rpc: unknown }).rpc = {
			unary: async () => {
				calls++;
				return { output: "page summary" };
			},
		};

		const base = await ensurePageContext({
			model: { modelId: "model-x" },
			services: {},
			srcLang: "en",
			dstLang: "zh",
			url: "https://example.com/page",
		});
		const viaHash = await ensurePageContext({
			model: { modelId: "model-x" },
			services: {},
			srcLang: "en",
			dstLang: "zh",
			url: "https://example.com/page#1-note",
		});
		const viaOtherHash = await ensurePageContext({
			model: { modelId: "model-x" },
			services: {},
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
			model: { modelId: "model-x" },
			services: {},
			srcLang: "en",
			dstLang: "zh",
			url: "https://example.com/other",
		});

		expect(result).toBe("other summary");
		expect(calls).toBe(1);
	});
});

describe("page context generation gate", () => {
	test("explicit preparation reuses captured content and one inflight request", async () => {
		const response = Promise.withResolvers<{ output: string }>();
		let calls = 0;
		(window as unknown as { rpc: unknown }).rpc = {
			unary: () => {
				calls++;
				return response.promise;
			},
		};
		let ctx!: ReturnType<typeof usePageContext>;
		const dispose = createRoot((dispose) => {
			ctx = usePageContext({
				model: () => ({ modelId: "explicit-model" }),
				services: () => ({}),
				srcLang: () => "en",
				dstLang: () => "zh",
				active: () => true,
				generate: () => false,
			});
			return dispose;
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(calls).toBe(0);
		// Translation UI now excludes the article from extraction. Preparation
		// must use the snapshot captured on mount rather than reading it again.
		const article = document.querySelector("article");
		article?.setAttribute("data-pt-translated", "");
		try {
			const first = ctx.ensure();
			const second = ctx.ensure();
			expect(calls).toBe(1);
			expect(ctx.ready()).toBe(false);
			response.resolve({ output: "prepared once" });
			expect(await first).toBe("prepared once");
			expect(await second).toBe("prepared once");
			expect(ctx.text()).toBe("prepared once");
			expect(ctx.ready()).toBe(true);
		} finally {
			article?.removeAttribute("data-pt-translated");
			dispose();
		}
	});

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
				model: () => ({ modelId: "model-y" }),
				services: () => ({}),
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
