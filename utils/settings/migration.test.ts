import { describe, expect, mock, test } from "bun:test";
import { SETTINGS_VERSION } from "./version";

mock.module("~/utils/i18n", () => ({
	t: (key: string) => key,
	i18n: { t: (key: string) => key },
}));

const mockBrowser = {
	i18n: {
		getMessage: (key: string) => key,
		getUILanguage: () => "en",
	},
	runtime: { getBrowserInfo: async () => ({}) },
};
mock.module("#imports", () => ({ browser: mockBrowser }));
mock.module("@wxt-dev/browser", () => ({ browser: mockBrowser }));

const { migrateSettings } = await import("./migration");
const { generateDefaultSettings } = await import("./default");
const { PROMPT_ID } = await import("~/utils/constants");

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
		expect(result.translate.inTextTranslationActionsEnabled).toBe(true);
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

	test("migrates from v9 to v10 nesting LLM models under services", () => {
		const v9Settings = {
			__v: 9,
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
				inTextTranslationActionsEnabled: true,
				translateFullPage: false,
				inputTranslateLang: "en",
				inTextTranslateModel: "11111111-1111-4111-8111-111111111111",
			},
			summary: {
				summaryModel: "11111111-1111-4111-8111-111111111111",
				summaryDefaultPinned: false,
				summaryGeometryMaxEntries: 1000,
			},
			services: {
				"11111111-1111-4111-8111-111111111111": {
					type: "llm",
					name: "OpenAI",
					apiSpec: "openai",
					baseUrl: "https://api.openai.com/v1",
					apiKey: "sk-test",
					model: "gpt-5",
					temperature: 0.7,
					maxOutputTokens: 2048,
					thinkingBudget: "high",
					extraBody: { top_k: 3 },
				},
				"33333333-3333-4333-8333-333333333333": {
					type: "llm",
					name: "NoModel",
					apiSpec: "anthropic",
					baseUrl: "https://api.anthropic.com",
				},
				"44444444-4444-4444-8444-444444444444": {
					type: "traditional",
					name: "DeepL",
					apiSpec: "deepl",
					apiKey: "deepl-key",
				},
			},
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

		const result = migrateSettings(v9Settings);
		expect(result.__v).toBe(SETTINGS_VERSION);

		const service = result.services["11111111-1111-4111-8111-111111111111"];
		expect(service.type).toBe("llm");
		if (service.type !== "llm") throw new Error("unreachable");
		// Model key reuses the service UUID so existing references keep working.
		expect(Object.keys(service.models)).toEqual([
			"11111111-1111-4111-8111-111111111111",
		]);
		expect(service.models["11111111-1111-4111-8111-111111111111"]).toEqual({
			name: "gpt-5",
			temperature: 0.7,
			maxOutputTokens: 2048,
			thinkingBudget: "high",
			extraBody: { top_k: 3 },
		});
		expect(service).not.toHaveProperty("model");
		expect(service).not.toHaveProperty("temperature");

		const emptyService =
			result.services["33333333-3333-4333-8333-333333333333"];
		expect(emptyService.type).toBe("llm");
		if (emptyService.type !== "llm") throw new Error("unreachable");
		expect(emptyService.models).toEqual({});

		const traditional = result.services["44444444-4444-4444-8444-444444444444"];
		expect(traditional.type).toBe("traditional");
		expect(traditional).not.toHaveProperty("models");

		// References pointing at the old service UUID remain valid.
		expect(result.translate.inTextTranslateModel).toBe(
			"11111111-1111-4111-8111-111111111111",
		);
		expect(result.summary.summaryModel).toBe(
			"11111111-1111-4111-8111-111111111111",
		);
	});

	test("migrates from v10 to v11 adding the page-context prompt", () => {
		const defaults = generateDefaultSettings();
		const v10Settings = {
			...defaults,
			__v: 10,
			prompts: {
				...defaults.prompts,
				[PROMPT_ID.summary]: {
					...defaults.prompts[PROMPT_ID.summary],
					systemPrompt: "custom summary prompt",
				},
			},
		};
		delete (v10Settings.prompts as Record<string, unknown>)[
			PROMPT_ID.pageContext
		];

		const result = migrateSettings(v10Settings);
		expect(result.__v).toBe(SETTINGS_VERSION);
		expect(result.prompts[PROMPT_ID.pageContext]).toEqual(
			defaults.prompts[PROMPT_ID.pageContext],
		);
		expect(result.prompts[PROMPT_ID.batchTranslate].systemPrompt).toContain(
			"<context>",
		);
		expect(result.prompts[PROMPT_ID.translate].systemPrompt).toContain(
			"<context>",
		);
		expect(result.prompts[PROMPT_ID.explain].systemPrompt).toContain(
			"<context>",
		);
		expect(result.prompts[PROMPT_ID.summary].systemPrompt).toBe(
			"custom summary prompt",
		);
		expect(result.summary.pageContextModel).toBeUndefined();
	});
});
