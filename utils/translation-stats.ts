import { browser } from "#imports";
import { STORAGE_KEYS } from "~/utils/constants";

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
	/** Last update timestamp. */
	updatedAt: number;
}

export type TranslationStatsDelta = Partial<
	Omit<TranslationStats, "updatedAt">
>;

export const emptyTranslationStats = (): TranslationStats => ({
	chars: 0,
	llmRequests: 0,
	traditionalRequests: 0,
	cacheHits: 0,
	promptTokens: 0,
	completionTokens: 0,
	totalTokens: 0,
	cachedTokens: 0,
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
] as const satisfies readonly (keyof TranslationStatsDelta)[];

export const getTranslationStats = async (): Promise<TranslationStats> => {
	const result = await browser.storage.local.get([
		STORAGE_KEYS.translationStats,
	]);
	const stored = result[STORAGE_KEYS.translationStats] as
		| Partial<TranslationStats>
		| undefined;
	return { ...emptyTranslationStats(), ...stored };
};

export const resetTranslationStats = async (): Promise<void> => {
	await browser.storage.local.remove(STORAGE_KEYS.translationStats);
};

// Serialize read-modify-write cycles so concurrent recordings cannot race.
let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * Accumulate stats into storage. Fire-and-forget: failures are swallowed so
 * statistics can never break translation.
 */
export const recordTranslationStats = (delta: TranslationStatsDelta): void => {
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
			next.updatedAt = Date.now();
			await browser.storage.local.set({
				[STORAGE_KEYS.translationStats]: next,
			});
		})
		.catch(() => {});
	writeQueue = write;
};
