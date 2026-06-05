import { describe, expect, test } from "bun:test";

const { detectSourceLanguage } = await import("~/utils/language-detection");

describe("detectSourceLanguage", () => {
	test("detects English text", async () => {
		const result = await detectSourceLanguage(
			"This is an English sentence for detection",
		);
		expect(result).toBe("en");
	});

	test("detects Chinese text", async () => {
		const result = await detectSourceLanguage("这是一段中文文本用于语言检测");
		expect(result).toBe("zh");
	});

	test("detects Japanese text", async () => {
		const result = await detectSourceLanguage(
			"これは日本語のテキストです。言語検出のための文章です。",
		);
		expect(result).toBe("ja");
	});

	test("detects Korean text", async () => {
		const result = await detectSourceLanguage(
			"이것은 한국어 텍스트입니다. 언어 감지를 위한 문장입니다.",
		);
		expect(result).toBe("ko");
	});

	test("returns null for empty string", async () => {
		expect(await detectSourceLanguage("")).toBeNull();
	});

	test("returns null for whitespace-only string", async () => {
		expect(await detectSourceLanguage("   \n\t  ")).toBeNull();
	});
});
