import { browser } from "#imports";
import { STORAGE_KEYS } from "~/utils/constants";

/**
 * Cumulative usage and latency counters for one configured LLM model.
 *
 * Latency figures are stored as sums plus sample counts instead of averages:
 * merging a delta is then pure addition, and readers derive the averages.
 */
export interface ModelUsage {
	/** `service / model` snapshot, so a deleted model still reads. */
	label: string;
	/** Completed requests, matching the top-level `llmRequests` counter. */
	requests: number;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cachedTokens: number;
	/** Requests that produced a measurable first token (streaming only). */
	ttftSamples: number;
	/** Sum of measured first-token latencies, in milliseconds. */
	ttftMs: number;
	/**
	 * Sum of the windows the TPS figure divides, in milliseconds. Streaming
	 * requests measure from the first token (TTFT is reported separately);
	 * unary requests measure the whole call, having no first-token signal.
	 */
	generationMs: number;
	/** Last request time; also orders the table and picks LRU evictions. */
	updatedAt: number;
}

/** A model entry with the settings key it was recorded under. */
export interface ModelUsageEntry {
	id: string;
	usage: ModelUsage;
}

export type ModelUsageDelta = Partial<Omit<ModelUsage, "updatedAt">>;

/**
 * Cumulative translation usage statistics.
 *
 * Token figures are real usage reported by LLM APIs (input/output/total).
 * Traditional services (Google/Bing/DeepL...) do not report usage, so only
 * their request and character counts are tracked.
 */
export interface TranslationStats {
	/** Total translated source characters, including cache hits. */
	chars: number;
	/** LLM API request count. */
	llmRequests: number;
	/** Traditional API request count. */
	traditionalRequests: number;
	/** Requests served from the local result cache without calling an API. */
	cacheHits: number;
	/** LLM input tokens (API-reported usage). */
	promptTokens: number;
	/** LLM output tokens (API-reported usage). */
	completionTokens: number;
	/** LLM total tokens (API-reported usage). */
	totalTokens: number;
	/** Input tokens served from the LLM provider's prompt cache. */
	cachedTokens: number;
	/** LLM input tokens used for webpage structure analysis. */
	webAdaptationPromptTokens: number;
	/** LLM output tokens used for webpage structure analysis. */
	webAdaptationCompletionTokens: number;
	/** LLM total tokens used for webpage structure analysis. */
	webAdaptationTotalTokens: number;
	/** Per-model usage and latency counters, keyed by model settings id. */
	models: Record<string, ModelUsage>;
	/** Last update timestamp. */
	updatedAt: number;
}

export type TranslationStatsDelta = Partial<
	Omit<TranslationStats, "updatedAt" | "models">
> & {
	models?: Record<string, ModelUsageDelta>;
};

/**
 * Statistics as they may exist on disk: older versions wrote fewer fields,
 * and a model entry can always be malformed. Reads normalize instead of
 * trusting the stored shape.
 */
export type StoredTranslationStats = Partial<
	Omit<TranslationStats, "models">
> & {
	models?: Record<string, Partial<ModelUsage>>;
};

export const emptyTranslationStats = (): TranslationStats => ({
	chars: 0,
	llmRequests: 0,
	traditionalRequests: 0,
	cacheHits: 0,
	promptTokens: 0,
	completionTokens: 0,
	totalTokens: 0,
	cachedTokens: 0,
	webAdaptationPromptTokens: 0,
	webAdaptationCompletionTokens: 0,
	webAdaptationTotalTokens: 0,
	models: {},
	updatedAt: 0,
});

const ADDITIVE_FIELDS = [
	"chars",
	"llmRequests",
	"traditionalRequests",
	"cacheHits",
	"promptTokens",
	"completionTokens",
	"totalTokens",
	"cachedTokens",
	"webAdaptationPromptTokens",
	"webAdaptationCompletionTokens",
	"webAdaptationTotalTokens",
] as const satisfies readonly (keyof TranslationStatsDelta)[];

/** Keep the table bounded so a long tail of one-off models cannot grow it. */
export const MAX_TRACKED_MODELS = 24;

const MODEL_ADDITIVE_FIELDS = [
	"requests",
	"promptTokens",
	"completionTokens",
	"totalTokens",
	"cachedTokens",
	"ttftSamples",
	"ttftMs",
	"generationMs",
] as const satisfies readonly (keyof Omit<ModelUsage, "label" | "updatedAt">)[];

const isPositiveCount = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value > 0;

const normalizeModelUsage = (
	raw: Partial<ModelUsage> | undefined,
): ModelUsage => {
	const usage: ModelUsage = {
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
	};
	for (const field of MODEL_ADDITIVE_FIELDS) {
		if (isPositiveCount(raw?.[field])) {
			usage[field] = raw[field] as number;
		}
	}
	if (typeof raw?.label === "string") {
		usage.label = raw.label;
	}
	if (isPositiveCount(raw?.updatedAt)) {
		usage.updatedAt = raw.updatedAt;
	}
	return usage;
};

const pruneModelUsage = (
	models: Record<string, ModelUsage>,
): Record<string, ModelUsage> => {
	const ids = Object.keys(models);
	if (ids.length <= MAX_TRACKED_MODELS) {
		return models;
	}
	// Stable sort: entries recorded in the same millisecond keep insertion
	// order, so the one added first loses the tie and is evicted.
	ids.sort((a, b) => models[a].updatedAt - models[b].updatedAt);
	const kept = { ...models };
	for (const id of ids.slice(0, ids.length - MAX_TRACKED_MODELS)) {
		delete kept[id];
	}
	return kept;
};

const normalizeModelUsageMap = (
	raw: Record<string, Partial<ModelUsage>> | undefined,
): Record<string, ModelUsage> => {
	if (!raw || typeof raw !== "object") {
		return {};
	}
	const models: Record<string, ModelUsage> = {};
	for (const [id, entry] of Object.entries(raw)) {
		if (!entry || typeof entry !== "object") {
			continue;
		}
		models[id] = normalizeModelUsage(entry);
	}
	return pruneModelUsage(models);
};

const mergeModelUsage = (
	current: Record<string, ModelUsage>,
	deltas: Record<string, ModelUsageDelta> | undefined,
): Record<string, ModelUsage> => {
	if (!deltas) {
		return current;
	}
	const merged = { ...current };
	const now = Date.now();
	for (const [id, delta] of Object.entries(deltas)) {
		const entry = merged[id]
			? { ...normalizeModelUsage(merged[id]) }
			: normalizeModelUsage(undefined);
		if (delta.label) {
			entry.label = delta.label;
		}
		for (const field of MODEL_ADDITIVE_FIELDS) {
			if (isPositiveCount(delta[field])) {
				entry[field] += delta[field] as number;
			}
		}
		entry.updatedAt = now;
		merged[id] = entry;
	}
	return pruneModelUsage(merged);
};

/**
 * Fill in fields that a stored record predates. Storage may hold data written
 * by an older version, so every read goes through here instead of trusting the
 * stored shape.
 */
export const normalizeTranslationStats = (
	raw: StoredTranslationStats | undefined,
): TranslationStats => ({
	...emptyTranslationStats(),
	...raw,
	models: normalizeModelUsageMap(raw?.models),
});

export const getTranslationStats = async (): Promise<TranslationStats> => {
	const result = await browser.storage.local.get([
		STORAGE_KEYS.translationStats,
	]);
	return normalizeTranslationStats(
		result[STORAGE_KEYS.translationStats] as StoredTranslationStats | undefined,
	);
};

export const resetTranslationStats = async (): Promise<void> => {
	await browser.storage.local.remove(STORAGE_KEYS.translationStats);
};

/** Average output tokens per second, or null when nothing was measured. */
export const modelTokensPerSecond = (usage: ModelUsage): number | null =>
	usage.generationMs > 0 && usage.completionTokens > 0
		? (usage.completionTokens * 1000) / usage.generationMs
		: null;

/** Average first-token latency in milliseconds, or null without samples. */
export const modelFirstTokenLatency = (usage: ModelUsage): number | null =>
	usage.ttftSamples > 0 ? usage.ttftMs / usage.ttftSamples : null;

/** Model entries ordered by most recently used, for the statistics table. */
export const modelUsageList = (
	models: Record<string, ModelUsage>,
): ModelUsageEntry[] =>
	Object.entries(models)
		.map(([id, usage]) => ({ id, usage }))
		.sort((a, b) => b.usage.updatedAt - a.usage.updatedAt);

// Serialize read-modify-write cycles so concurrent recordings cannot race.
let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * Accumulate stats into storage. Fire-and-forget: failures are swallowed so
 * statistics can never break translation. Returns the queued write so callers
 * that must observe the result (tests) can await it; production paths ignore
 * the value.
 */
export const recordTranslationStats = (
	delta: TranslationStatsDelta,
): Promise<void> => {
	const write = writeQueue
		.then(async () => {
			const current = await getTranslationStats();
			const next = { ...current };
			for (const field of ADDITIVE_FIELDS) {
				const value = delta[field];
				if (typeof value === "number" && value > 0) {
					next[field] += value;
				}
			}
			next.models = mergeModelUsage(current.models, delta.models);
			next.updatedAt = Date.now();
			await browser.storage.local.set({
				[STORAGE_KEYS.translationStats]: next,
			});
		})
		.catch(() => {});
	writeQueue = write;
	return write;
};
