import { describe, expect, test } from "bun:test";
import { computeCacheKey } from "./hasher";
import type { TranslateContext } from "./types";

const hex = (buf: ArrayBuffer) =>
	Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

const baseCtx = (): TranslateContext => ({
	page: { domain: "example.com", title: "Example" },
});

describe("computeCacheKey", () => {
	test("ignores the LLM-generated page context", async () => {
		const withContextA = await computeCacheKey(
			"prompt",
			"model",
			"hello",
			{ ...baseCtx(), pageContext: "A technology blog about web browsers." },
			"en",
			"zh",
		);
		const withContextB = await computeCacheKey(
			"prompt",
			"model",
			"hello",
			{ ...baseCtx(), pageContext: "另一种完全不同的页面描述" },
			"en",
			"zh",
		);
		const withoutContext = await computeCacheKey(
			"prompt",
			"model",
			"hello",
			baseCtx(),
			"en",
			"zh",
		);

		expect(hex(withContextA)).toBe(hex(withContextB));
		expect(hex(withContextA)).toBe(hex(withoutContext));
	});

	test("still separates prompt, model, text, domain and languages", async () => {
		const base = await computeCacheKey(
			"prompt",
			"model",
			"hello",
			baseCtx(),
			"en",
			"zh",
		);

		const otherPrompt = await computeCacheKey(
			"other-prompt",
			"model",
			"hello",
			baseCtx(),
			"en",
			"zh",
		);
		const otherModel = await computeCacheKey(
			"prompt",
			"other-model",
			"hello",
			baseCtx(),
			"en",
			"zh",
		);
		const otherText = await computeCacheKey(
			"prompt",
			"model",
			"goodbye",
			baseCtx(),
			"en",
			"zh",
		);
		const otherDomain = await computeCacheKey(
			"prompt",
			"model",
			"hello",
			{ page: { domain: "other.com", title: "Other" } },
			"en",
			"zh",
		);
		const otherLangs = await computeCacheKey(
			"prompt",
			"model",
			"hello",
			baseCtx(),
			"en",
			"ja",
		);

		for (const key of [
			otherPrompt,
			otherModel,
			otherText,
			otherDomain,
			otherLangs,
		]) {
			expect(hex(key)).not.toBe(hex(base));
		}
	});

	test("hashes array payloads entry by entry, in order", async () => {
		const forward = await computeCacheKey(
			"prompt",
			"model",
			["one", "two"],
			baseCtx(),
			"en",
			"zh",
		);
		const reversed = await computeCacheKey(
			"prompt",
			"model",
			["two", "one"],
			baseCtx(),
			"en",
			"zh",
		);

		expect(hex(forward)).not.toBe(hex(reversed));
	});
});
