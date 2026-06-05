import { describe, expect, mock, test } from "bun:test";

mock.module("~/utils/browser-translator", () => ({
	checkLanguageDetectorSupport: async () => ({
		isSupported: true,
		availability: "available" as const,
	}),
	createBrowserLanguageDetector: async () => ({
		detect: async (text: string) => {
			if (text.includes("Hello") || text.includes("world")) {
				return [{ detectedLanguage: "en", confidence: 1.0 }];
			}
			if (text.includes("你好") || text.includes("世界")) {
				return [{ detectedLanguage: "zh-CN", confidence: 1.0 }];
			}
			return [];
		},
		destroy: () => {},
	}),
}));

const { detectSourceLanguage } = await import("~/utils/language-detection");

describe("detectSourceLanguage", () => {
	test("detects English text", async () => {
		const result = await detectSourceLanguage("Hello world");
		expect(result).toBe("en");
	});

	test("detects Chinese text", async () => {
		const result = await detectSourceLanguage("你好世界");
		expect(result).toBe("zh-CN");
	});

	test("returns null for empty string", async () => {
		expect(await detectSourceLanguage("")).toBeNull();
	});

	test("returns null for whitespace-only string", async () => {
		expect(await detectSourceLanguage("   \n\t  ")).toBeNull();
	});

	test("returns null when detector returns no results", async () => {
		expect(await detectSourceLanguage("xyz123")).toBeNull();
	});
});
