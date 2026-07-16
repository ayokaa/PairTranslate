import { describe, expect, test } from "bun:test";
import { hasMeaningfulChars } from "./blank";

describe("hasMeaningfulChars", () => {
	test("accepts text containing Unicode letters", () => {
		expect(hasMeaningfulChars("Translate this")).toBe(true);
		expect(hasMeaningfulChars("翻译这段文字")).toBe(true);
		expect(hasMeaningfulChars("Qwen3.5")).toBe(true);
	});

	test("rejects numeric and symbol-only expressions", () => {
		expect(hasMeaningfulChars("56.6%")).toBe(false);
		expect(hasMeaningfulChars("61.1 ± 0.79")).toBe(false);
		expect(hasMeaningfulChars("–")).toBe(false);
		expect(hasMeaningfulChars("↑ 2026")).toBe(false);
	});

	test("rejects empty and single-character text", () => {
		expect(hasMeaningfulChars(undefined)).toBe(false);
		expect(hasMeaningfulChars(" ")).toBe(false);
		expect(hasMeaningfulChars("A")).toBe(false);
	});
});
