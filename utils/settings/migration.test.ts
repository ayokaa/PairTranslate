import { describe, expect, mock, test } from "bun:test";
import { SETTINGS_VERSION } from "./version";

mock.module("~/utils/i18n", () => ({
	t: (key: string) => key,
	i18n: { t: (key: string) => key },
}));

const mockBrowser = {
	i18n: { getMessage: (key: string) => key },
	runtime: { getBrowserInfo: async () => ({}) },
};
mock.module("#imports", () => ({ browser: mockBrowser }));
mock.module("@wxt-dev/browser", () => ({ browser: mockBrowser }));

const { SettingsSchema } = await import("./def");
const { migrateSettings } = await import("./migration");

describe("migrateSettings", () => {
	test("rejects null/undefined payload", () => {
		expect(() => migrateSettings(null)).toThrow();
		expect(() => migrateSettings(undefined)).toThrow();
	});

	test("migrates from v4 to v5 adding summaryExcludedSites", () => {
		const v4Settings = {
			__v: 4,
			basic: {
				enabled: true,
				theme: "system",
				selectionPopupEnabled: true,
				autoPin: false,
				floatingBallEnabled: true,
				floatingBallPosition: { side: "right", top: 20 },
				keyboardShortcutEnabled: true,
				keyboardShortcut: "Alt+T",
				selectionTranslateEnabled: true,
				selectionTranslateModifier: "Alt",
				inputTranslateEnabled: true,
				progressIndicationEnabled: true,
				translationStyle: {},
				keyboardShortcutSummarizes: false,
				keyboardShortcutForSummary: "Alt+T",
			},
			translate: {
				sourceLang: "auto",
				targetLang: "en",
				filterInteractive: true,
				translationMode: "parallel",
				inTextTranslateIconEnabled: true,
				translateFullPage: false,
				inputTranslateLang: "en",
				summaryModel: undefined,
			},
			services: {},
			queue: {
				requestConcurrency: 4,
				tokensPerMinute: 80000,
				maxBatchSize: 8,
				maxTokensPerBatch: 8000,
				cacheSize: 1000,
			},
			prompts: {},
			websiteRules: [],
			debug: {
				verboseLogging: false,
				traceLlms: false,
				traceTraditional: false,
				disableCache: false,
				simulateLatencyMs: 0,
			},
		};

		const result = migrateSettings(v4Settings);
		expect(result.__v).toBe(SETTINGS_VERSION);
		expect(result.translate.summaryExcludedSites).toEqual([]);
	});

	test("migrates from v5 to v6 adding summaryDefaultPinned", () => {
		const v5Settings = {
			__v: 5,
			basic: {
				enabled: true,
				theme: "system",
				selectionPopupEnabled: true,
				autoPin: false,
				floatingBallEnabled: true,
				floatingBallPosition: { side: "right", top: 20 },
				keyboardShortcutEnabled: true,
				keyboardShortcut: "Alt+T",
				selectionTranslateEnabled: true,
				selectionTranslateModifier: "Alt",
				inputTranslateEnabled: true,
				progressIndicationEnabled: true,
				translationStyle: {},
				keyboardShortcutSummarizes: false,
				keyboardShortcutForSummary: "Alt+T",
			},
			translate: {
				sourceLang: "auto",
				targetLang: "en",
				filterInteractive: true,
				translationMode: "parallel",
				inTextTranslateIconEnabled: true,
				translateFullPage: false,
				inputTranslateLang: "en",
				summaryModel: undefined,
				summaryExcludedSites: [],
			},
			services: {},
			queue: {
				requestConcurrency: 4,
				tokensPerMinute: 80000,
				maxBatchSize: 8,
				maxTokensPerBatch: 8000,
				cacheSize: 1000,
			},
			prompts: {},
			websiteRules: [],
			debug: {
				verboseLogging: false,
				traceLlms: false,
				traceTraditional: false,
				disableCache: false,
				simulateLatencyMs: 0,
			},
		};

		const result = migrateSettings(v5Settings);
		expect(result.__v).toBe(SETTINGS_VERSION);
		expect(result.translate.summaryDefaultPinned).toBe(false);
	});
});

describe("TranslateSettings schema", () => {
	test("accepts summaryExcludedSites with domain patterns", () => {
		const result = SettingsSchema.safeParse({
			__v: SETTINGS_VERSION,
			basic: {
				enabled: true,
				theme: "system",
				selectionPopupEnabled: true,
				autoPin: false,
				floatingBallEnabled: true,
				floatingBallPosition: { side: "right", top: 20 },
				keyboardShortcutEnabled: true,
				keyboardShortcut: "Alt+T",
				selectionTranslateEnabled: true,
				selectionTranslateModifier: "Alt",
				inputTranslateEnabled: true,
				progressIndicationEnabled: true,
				translationStyle: {},
				keyboardShortcutSummarizes: false,
				keyboardShortcutForSummary: "Alt+T",
			},
			translate: {
				sourceLang: "auto",
				targetLang: "en",
				filterInteractive: true,
				translationMode: "parallel",
				inTextTranslateIconEnabled: true,
				translateFullPage: false,
				inputTranslateLang: "en",
				summaryExcludedSites: ["*.example.com", "test.org"],
			},
			services: {},
			queue: {
				requestConcurrency: 4,
				tokensPerMinute: 80000,
				maxBatchSize: 8,
				maxTokensPerBatch: 8000,
				cacheSize: 1000,
			},
			prompts: {},
			websiteRules: [],
			debug: {
				verboseLogging: false,
				traceLlms: false,
				traceTraditional: false,
				disableCache: false,
				simulateLatencyMs: 0,
			},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.translate.summaryExcludedSites).toEqual([
				"*.example.com",
				"test.org",
			]);
		}
	});

	test("defaults summaryExcludedSites to empty array when omitted", () => {
		const result = SettingsSchema.safeParse({
			__v: SETTINGS_VERSION,
			basic: {
				enabled: true,
				theme: "system",
				selectionPopupEnabled: true,
				autoPin: false,
				floatingBallEnabled: true,
				floatingBallPosition: { side: "right", top: 20 },
				keyboardShortcutEnabled: true,
				keyboardShortcut: "Alt+T",
				selectionTranslateEnabled: true,
				selectionTranslateModifier: "Alt",
				inputTranslateEnabled: true,
				progressIndicationEnabled: true,
				translationStyle: {},
				keyboardShortcutSummarizes: false,
				keyboardShortcutForSummary: "Alt+T",
			},
			translate: {
				sourceLang: "auto",
				targetLang: "en",
				filterInteractive: true,
				translationMode: "parallel",
				inTextTranslateIconEnabled: true,
				translateFullPage: false,
				inputTranslateLang: "en",
			},
			services: {},
			queue: {
				requestConcurrency: 4,
				tokensPerMinute: 80000,
				maxBatchSize: 8,
				maxTokensPerBatch: 8000,
				cacheSize: 1000,
			},
			prompts: {},
			websiteRules: [],
			debug: {
				verboseLogging: false,
				traceLlms: false,
				traceTraditional: false,
				disableCache: false,
				simulateLatencyMs: 0,
			},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.translate.summaryExcludedSites).toEqual([]);
		}
	});
});
