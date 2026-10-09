import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ModelUsage, StoredTranslationStats } from "./translation-stats";

// In-memory browser.storage.local, following the pattern in
// utils/summary/popup-storage.test.ts: the statistics module talks to
// extension storage directly, so the round trip is what has to be exercised.
const localStore = new Map<string, unknown>();

const mockBrowser = {
	storage: {
		local: {
			get: async (keys: string | string[]) => {
				const keyList = Array.isArray(keys) ? keys : [keys];
				const result: Record<string, unknown> = {};
				for (const key of keyList) {
					if (localStore.has(key)) result[key] = localStore.get(key);
				}
				return result;
			},
			set: async (items: Record<string, unknown>) => {
				for (const [key, value] of Object.entries(items)) {
					localStore.set(key, value);
				}
			},
			remove: async (keys: string | string[]) => {
				const keyList = Array.isArray(keys) ? keys : [keys];
				for (const key of keyList) localStore.delete(key);
			},
		},
	},
};
mock.module("#imports", () => ({ browser: mockBrowser }));
mock.module("@wxt-dev/browser", () => ({ browser: mockBrowser }));

const {
	MAX_TRACKED_MODELS,
	emptyTranslationStats,
	getTranslationStats,
	modelFirstTokenLatency,
	modelTokensPerSecond,
	modelUsageList,
	normalizeTranslationStats,
	recordTranslationStats,
	resetTranslationStats,
} = await import("./translation-stats");

/** A fully populated usage record; tests override only the fields they mean. */
const usage = (partial: Partial<ModelUsage>): ModelUsage => ({
	label: "",
	requests: 0,
	promptTokens: 0,
	completionTokens: 0,
	totalTokens: 0,
	cachedTokens: 0,
	ttftSamples: 0,
	ttftMs: 0,
	generationMs: 0,
	updatedAt: 0,
	...partial,
});

beforeEach(() => {
	localStore.clear();
});

describe("recordTranslationStats", () => {
	test("accumulates flat counters and per-model usage across recordings", async () => {
		await recordTranslationStats({
			llmRequests: 1,
			promptTokens: 10,
			completionTokens: 4,
			models: {
				"model-a": {
					label: "Service / A",
					requests: 1,
					promptTokens: 10,
					completionTokens: 4,
					totalTokens: 14,
					generationMs: 500,
					ttftMs: 120,
					ttftSamples: 1,
				},
			},
		});
		await recordTranslationStats({
			llmRequests: 1,
			promptTokens: 20,
			completionTokens: 6,
			models: {
				"model-a": {
					requests: 1,
					promptTokens: 20,
					completionTokens: 6,
					totalTokens: 26,
					generationMs: 1000,
				},
			},
		});

		const stats = await getTranslationStats();
		expect(stats.llmRequests).toBe(2);
		expect(stats.promptTokens).toBe(30);
		expect(stats.completionTokens).toBe(10);
		expect(stats.models["model-a"]).toMatchObject({
			label: "Service / A",
			requests: 2,
			promptTokens: 30,
			completionTokens: 10,
			totalTokens: 40,
			ttftSamples: 1,
			ttftMs: 120,
			generationMs: 1500,
		});
	});

	test("keeps one entry per model", async () => {
		await recordTranslationStats({
			models: { "model-a": { label: "Service / A", requests: 1 } },
		});
		await recordTranslationStats({
			models: { "model-b": { label: "Service / B", requests: 1 } },
		});

		const stats = await getTranslationStats();
		expect(Object.keys(stats.models).sort()).toEqual(["model-a", "model-b"]);
	});

	test("evicts the least recently used model beyond the table cap", async () => {
		const total = MAX_TRACKED_MODELS + 4;
		for (let index = 0; index < total; index++) {
			await recordTranslationStats({
				models: {
					[`model-${index}`]: { label: `Service / ${index}`, requests: 1 },
				},
			});
		}

		const stats = await getTranslationStats();
		expect(Object.keys(stats.models)).toHaveLength(MAX_TRACKED_MODELS);
		expect(stats.models["model-0"]).toBeUndefined();
		expect(stats.models["model-3"]).toBeUndefined();
		expect(stats.models[`model-${total - 1}`]).toBeDefined();
	});

	test("clears model entries together with the counters", async () => {
		await recordTranslationStats({
			llmRequests: 1,
			models: { "model-a": { label: "Service / A", requests: 1 } },
		});
		await resetTranslationStats();
		expect(await getTranslationStats()).toEqual(emptyTranslationStats());
	});
});

describe("modelUsageList", () => {
	test("orders entries by most recent use", () => {
		const list = modelUsageList({
			older: usage({ updatedAt: 1000 }),
			newer: usage({ updatedAt: 5000 }),
			middle: usage({ updatedAt: 3000 }),
		});
		expect(list.map((entry) => entry.id)).toEqual(["newer", "middle", "older"]);
	});
});

describe("normalizeTranslationStats", () => {
	test("fills fields that a stored record predates", () => {
		const stats = normalizeTranslationStats({
			chars: 12,
			llmRequests: 2,
			models: {
				"model-a": { label: "Service / A", requests: 2 },
			},
		});

		expect(stats.chars).toBe(12);
		expect(stats.llmRequests).toBe(2);
		expect(stats.webAdaptationTotalTokens).toBe(0);
		expect(stats.models["model-a"]).toEqual({
			label: "Service / A",
			requests: 2,
			promptTokens: 0,
			completionTokens: 0,
			totalTokens: 0,
			cachedTokens: 0,
			ttftSamples: 0,
			ttftMs: 0,
			generationMs: 0,
			updatedAt: 0,
		});
	});

	test("ignores malformed model entries instead of trusting them", () => {
		const stats = normalizeTranslationStats({
			models: {
				nulled: null,
				garbage: "not-an-object",
				"model-a": { requests: 1 },
			},
		} as unknown as StoredTranslationStats);

		expect(Object.keys(stats.models)).toEqual(["model-a"]);
	});
});

describe("model performance derivations", () => {
	test("computes average output tokens per second", () => {
		expect(
			modelTokensPerSecond(
				usage({ completionTokens: 100, generationMs: 2000 }),
			),
		).toBe(50);
		expect(
			modelTokensPerSecond(usage({ completionTokens: 100, generationMs: 0 })),
		).toBeNull();
		// Providers that do not report streamed usage leave nothing to divide.
		expect(
			modelTokensPerSecond(usage({ completionTokens: 0, generationMs: 2000 })),
		).toBeNull();
	});

	test("computes average first-token latency", () => {
		expect(modelFirstTokenLatency(usage({ ttftMs: 900, ttftSamples: 3 }))).toBe(
			300,
		);
		expect(
			modelFirstTokenLatency(usage({ ttftMs: 0, ttftSamples: 0 })),
		).toBeNull();
	});
});
