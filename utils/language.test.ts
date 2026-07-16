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

	test("keeps bare Chinese variant-unknown", () => {
		expect(areLanguagesSame("zh", "zh-CN")).toBe(false);
		expect(areLanguagesSame("zh", "zh-TW")).toBe(false);
		expect(areLanguagesSame("zh", "zh")).toBe(true);
	});

	test("compares explicit language variants normally", () => {
		expect(areLanguagesSame("zh-CN", "zh-CN")).toBe(true);
		expect(areLanguagesSame("zh-CN", "zh-TW")).toBe(false);
		expect(areLanguagesSame("zh-Hans", "zh-CN")).toBe(true);
		expect(areLanguagesSame("zh-HK", "zh-TW")).toBe(true);
		expect(areLanguagesSame("zh-HK", "zh-CN")).toBe(false);
		expect(areLanguagesSame("en-US", "en")).toBe(true);
		expect(areLanguagesSame("auto", "en")).toBe(true);
	});
});
