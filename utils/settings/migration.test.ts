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

const { migrateSettings } = await import("./migration");

describe("migrateSettings", () => {
	test("rejects null/undefined payload", () => {
		expect(() => migrateSettings(null)).toThrow();
		expect(() => migrateSettings(undefined)).toThrow();
	});

	test("migrates from v4 to v5 to final state", () => {
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
		expect(result.basic.restorePageState).toBe(true);
		expect(result.summary.summaryDefaultPinned).toBe(false);
		expect(result.summary.summaryGeometryMaxEntries).toBe(1000);
		expect(result.websiteRules).toEqual([]);
		expect(result.translate).not.toHaveProperty("summaryModel");
		expect(result.translate).not.toHaveProperty("summaryExcludedSites");
		expect(result.translate).not.toHaveProperty("summaryDefaultPinned");
		expect(result.translate).not.toHaveProperty("summaryGeometryMaxEntries");
	});

	test("migrates from v5 to v6 to final state", () => {
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
		expect(result.basic.restorePageState).toBe(true);
		expect(result.summary.summaryDefaultPinned).toBe(false);
		expect(result.summary.summaryGeometryMaxEntries).toBe(1000);
		expect(result.websiteRules).toEqual([]);
		expect(result.translate).not.toHaveProperty("summaryExcludedSites");
		expect(result.translate).not.toHaveProperty("summaryDefaultPinned");
		expect(result.translate).not.toHaveProperty("summaryGeometryMaxEntries");
	});

	test("migrates from v6 to v7 to final state", () => {
		const v6Settings = {
			__v: 6,
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
				summaryDefaultPinned: false,
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

		const result = migrateSettings(v6Settings);
		expect(result.__v).toBe(SETTINGS_VERSION);
		expect(result.basic.restorePageState).toBe(true);
		expect(result.summary.summaryDefaultPinned).toBe(false);
		expect(result.summary.summaryGeometryMaxEntries).toBe(1000);
		expect(result.websiteRules).toEqual([]);
		expect(result.translate).not.toHaveProperty("summaryExcludedSites");
		expect(result.translate).not.toHaveProperty("summaryDefaultPinned");
		expect(result.translate).not.toHaveProperty("summaryGeometryMaxEntries");
	});

	test("migrates from v7 to v8 to final state", () => {
		const v7Settings = {
			__v: 7,
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
				restorePageState: true,
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
				summaryDefaultPinned: false,
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

		const result = migrateSettings(v7Settings);
		expect(result.__v).toBe(SETTINGS_VERSION);
		expect(result.summary.summaryDefaultPinned).toBe(false);
		expect(result.summary.summaryGeometryMaxEntries).toBe(1000);
		expect(result.websiteRules).toEqual([]);
		expect(result.translate).not.toHaveProperty("summaryGeometryMaxEntries");
		expect(result.translate).not.toHaveProperty("summaryExcludedSites");
		expect(result.translate).not.toHaveProperty("summaryDefaultPinned");
	});

	test("migrates from v8 to v9 converting summary excluded sites to website rules", () => {
		const v8Settings = {
			__v: 8,
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
				restorePageState: true,
			},
			translate: {
				sourceLang: "auto",
				targetLang: "en",
				filterInteractive: true,
				translationMode: "parallel",
				inTextTranslateIconEnabled: true,
				translateFullPage: false,
				inputTranslateLang: "en",
				summaryModel: "550e8400-e29b-41d4-a716-446655440000",
				summaryExcludedSites: ["*.example.com", "test.org"],
				summaryDefaultPinned: true,
				summaryGeometryMaxEntries: 500,
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
			websiteRules: [
				{
					urlPatterns: ["existing.com"],
					enableTranslation: true,
				},
			],
			debug: {
				verboseLogging: false,
				traceLlms: false,
				traceTraditional: false,
				disableCache: false,
				simulateLatencyMs: 0,
			},
		};

		const result = migrateSettings(v8Settings);
		expect(result.__v).toBe(SETTINGS_VERSION);
		expect(result.summary.summaryDefaultPinned).toBe(true);
		expect(result.summary.summaryGeometryMaxEntries).toBe(500);
		expect(result.summary.summaryModel).toBe(
			"550e8400-e29b-41d4-a716-446655440000",
		);
		expect(result.translate).not.toHaveProperty("summaryExcludedSites");
		expect(result.websiteRules).toHaveLength(3);
		expect(result.websiteRules[1]).toEqual({
			urlPatterns: ["*.example.com"],
			enableSummary: false,
		});
		expect(result.websiteRules[2]).toEqual({
			urlPatterns: ["test.org"],
			enableSummary: false,
		});
	});
});
