import { describe, expect, mock, test } from "bun:test";

mock.module("#imports", () => ({
	browser: {
		i18n: {
			getUILanguage: () => "en-US",
		},
	},
}));

const { areLanguagesSame, isLanguageSupported } = await import("./language");

describe("language comparison", () => {
	test("recognizes bare Chinese as supported", () => {
		expect(isLanguageSupported("zh")).toBe(true);
	});

	test("treats every Chinese variant as the same language", () => {
		// A Chinese page is never translated into Chinese, in any combination.
		// The detector reports a bare "zh" for both scripts, and translating a
		// same-script page only hands the same text back — while still costing
		// one LLM round trip per batch.
		expect(areLanguagesSame("zh", "zh-CN")).toBe(true);
		expect(areLanguagesSame("zh", "zh-TW")).toBe(true);
		expect(areLanguagesSame("zh", "zh")).toBe(true);
		expect(areLanguagesSame("zh-CN", "zh-TW")).toBe(true);
		expect(areLanguagesSame("zh-Hans", "zh-CN")).toBe(true);
		expect(areLanguagesSame("zh-HK", "zh-TW")).toBe(true);
		expect(areLanguagesSame("zh-HK", "zh-CN")).toBe(true);
	});

	test("still separates different languages", () => {
		expect(areLanguagesSame("en-US", "en")).toBe(true);
		expect(areLanguagesSame("auto", "en")).toBe(true);
		expect(areLanguagesSame("en", "zh-CN")).toBe(false);
		expect(areLanguagesSame("zh-CN", "en")).toBe(false);
		expect(areLanguagesSame("ja", "zh-CN")).toBe(false);
	});
});
