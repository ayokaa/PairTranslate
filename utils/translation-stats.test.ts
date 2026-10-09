import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
	ModelRequestSample,
	ModelUsage,
	StoredTranslationStats,
} from "./translation-stats";

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
	PERFORMANCE_WINDOW,
	emptyTranslationStats,
	getTranslationStats,
	modelFirstTokenLatency,
	modelThroughput,
	modelUsageList,
	normalizeTranslationStats,
	recordTranslationStats,
	resetTranslationStats,
} = await import("./translation-stats");

/** A fully populated usage record; tests override only what they mean. */
const usage = (partial: Partial<ModelUsage>): ModelUsage => ({
	label: "",
	requests: 0,
	promptTokens: 0,
	completionTokens: 0,
	totalTokens: 0,
	cachedTokens: 0,
	recent: [],
	updatedAt: 0,
	...partial,
});

/** One request in the performance window. */
const sample = (partial: Partial<ModelRequestSample>): ModelRequestSample => ({
	completionTokens: 0,
	generationMs: 0,
	...partial,
});

beforeEach(() => {
	localStore.clear();
});

describe("recordTranslationStats", () => {
	test("accumulates counters and appends each request to the window", async () => {
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
					sample: { completionTokens: 4, generationMs: 500, ttftMs: 120 },
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
					sample: { completionTokens: 6, generationMs: 1000 },
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
		});
		expect(stats.models["model-a"].recent).toEqual([
			{ completionTokens: 4, generationMs: 500, ttftMs: 120 },
			{ completionTokens: 6, generationMs: 1000 },
		]);
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

	test("keeps only the most recent requests in the performance window", async () => {
		const total = PERFORMANCE_WINDOW + 5;
		for (let index = 0; index < total; index++) {
			await recordTranslationStats({
				models: {
					"model-a": {
						requests: 1,
						completionTokens: index + 1,
						sample: { completionTokens: index + 1, generationMs: 1000 },
					},
				},
			});
		}

		const entry = (await getTranslationStats()).models["model-a"];
		// Requests and tokens stay cumulative, so the evicted requests are
		// still paid for; only the window moves on.
		expect(entry.requests).toBe(total);
		expect(entry.completionTokens).toBe((total * (total + 1)) / 2);
		expect(entry.recent).toHaveLength(PERFORMANCE_WINDOW);
		expect(entry.recent[0].completionTokens).toBe(6);
		expect(entry.recent.at(-1)?.completionTokens).toBe(total);
		// Tokens 6..105 over 100 seconds: the speed figure rests on the window.
		expect(modelThroughput(entry)).toEqual({ value: 55.5, samples: 100 });
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
			recent: [],
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

	test("drops samples that carry nothing measurable", () => {
		const stats = normalizeTranslationStats({
			models: {
				"model-a": {
					recent: [
						null,
						"not-a-sample",
						{ completionTokens: 5 },
						{ generationMs: 400 },
						{ completionTokens: 3, generationMs: 0, ttftMs: 0 },
						{ completionTokens: 7, generationMs: 700, ttftMs: -5 },
					],
				},
			},
		} as unknown as StoredTranslationStats);

		expect(stats.models["model-a"].recent).toEqual([
			{ completionTokens: 0, generationMs: 400 },
			{ completionTokens: 7, generationMs: 700 },
		]);
	});

	test("caps a stored window at the newest samples", () => {
		const stored = Array.from(
			{ length: PERFORMANCE_WINDOW + 3 },
			(_, index) => ({
				completionTokens: index + 1,
				generationMs: 1000,
			}),
		);
		const stats = normalizeTranslationStats({
			models: { "model-a": { recent: stored } },
		} as unknown as StoredTranslationStats);

		expect(stats.models["model-a"].recent).toHaveLength(PERFORMANCE_WINDOW);
		expect(stats.models["model-a"].recent[0].completionTokens).toBe(4);
	});
});

describe("window metrics", () => {
	test("averages throughput over the window, weighted by output tokens", () => {
		const entry = usage({
			recent: [
				sample({ completionTokens: 100, generationMs: 2000 }),
				sample({ completionTokens: 300, generationMs: 2000 }),
			],
		});
		expect(modelThroughput(entry)).toEqual({ value: 100, samples: 2 });
	});

	test("leaves requests without reported output tokens out of throughput", () => {
		const entry = usage({ recent: [sample({ generationMs: 2000 })] });
		expect(modelThroughput(entry)).toEqual({ value: null, samples: 0 });
	});

	test("averages first-token latency over the streaming requests only", () => {
		const entry = usage({
			recent: [
				sample({ completionTokens: 1, generationMs: 10, ttftMs: 400 }),
				sample({ completionTokens: 1, generationMs: 10 }),
				sample({ completionTokens: 1, generationMs: 10, ttftMs: 800 }),
			],
		});
		expect(modelFirstTokenLatency(entry)).toEqual({ value: 600, samples: 2 });
		expect(modelFirstTokenLatency(usage({ recent: [] }))).toEqual({
			value: null,
			samples: 0,
		});
	});
});
