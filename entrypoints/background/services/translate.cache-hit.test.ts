import { beforeEach, expect, mock, test } from "bun:test";
import { MS_TRANSLATOR_ID, PROMPT_ID } from "~/utils/constants";
import type { TranslateContext } from "~/utils/types";

/**
 * Regression tests for "translation cache hits are slow".
 *
 * A cache hit costs no tokens and no concurrency, so it must not enter the model
 * queue: the queue throttles by tokens-per-minute, and once a page of real
 * requests has spent that budget, a page served entirely from cache would wait
 * for the refill before anything renders.
 *
 * These tests replace the model queue with a spy that never runs the task it is
 * handed. A hit that still goes through the queue is therefore visible twice:
 * as an enqueue attempt, and as the sentinel it answers with.
 */

const MODEL = MS_TRANSLATOR_ID;
const PROMPT = PROMPT_ID.batchTranslate;
const SRC = "en";
const DST = "zh-CN";
const ctx: TranslateContext = {
	page: { url: "https://example.com/a", domain: "example.com", title: "t" },
	pageContext: "[zh] page context",
};

const section = (i: number) =>
	`${i} — ${"The quick brown fox. ".repeat(6).trim()}`;
const segments = Array.from({ length: 8 }, (_, i) => section(i));
/** What the cache holds after a first visit. */
const cached = (text: string) => `[cached] ${text.slice(0, 24)}`;
/** What the (stubbed) translator returns. */
const fresh = (text: string) => `[fresh] ${text.slice(0, 24)}`;

type CacheEntry = { output: unknown; reasoning?: string };

/** In-memory stand-in for the IndexedDB result cache. */
const entries = new Map<string, CacheEntry>();
const keyOf = (key: ArrayBuffer) =>
	Array.from(new Uint8Array(key))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");

const cacheCalls = { get: 0 };
const fakeCache = {
	get: async (key: ArrayBuffer) => {
		cacheCalls.get++;
		return entries.get(keyOf(key));
	},
	set: async (key: ArrayBuffer, value: CacheEntry) => {
		entries.set(keyOf(key), value);
	},
	del: async (key: ArrayBuffer) => {
		entries.delete(keyOf(key));
	},
	clear: async () => entries.clear(),
	close: () => {},
	resize: () => {},
	stats: async () => ({
		entries: entries.size,
		bytes: 0,
		maxSize: 0,
		oldestUsedAt: 0,
	}),
};

/** Records enqueue attempts, then runs the task like the real queue does. */
const enqueued: string[] = [];
const spyQueue = {
	modelId: MODEL,
	updateLimits: () => {},
	status: () => ({
		modelId: MODEL,
		queued: 0,
		running: 0,
		tokensAvailable: 0,
		tokensPerMinute: 0,
		requestConcurrency: 0,
	}),
	enqueueUnary: async (runner: () => Promise<{ value: unknown }>) => {
		enqueued.push("unary");
		return (await runner()).value;
	},
	enqueueStream: async () => {
		enqueued.push("stream");
		throw new Error("not used by this test");
	},
};

const statsStore: Record<string, unknown> = {};
let settings: Awaited<ReturnType<typeof buildSettings>>;

mock.module("#imports", () => ({
	browser: {
		i18n: { getUILanguage: () => "en-US", getMessage: (key: string) => key },
		storage: {
			local: {
				get: async (keys: string | string[]) => {
					const names = Array.isArray(keys) ? keys : [keys];
					const result: Record<string, unknown> = {};
					for (const name of names) result[name] = statsStore[name];
					return result;
				},
				set: async (values: Record<string, unknown>) => {
					Object.assign(statsStore, values);
				},
				remove: async (keys: string | string[]) => {
					for (const key of Array.isArray(keys) ? keys : [keys])
						delete statsStore[key];
				},
			},
		},
	},
}));
mock.module("~/utils/i18n", () => ({
	i18n: { t: (key: string) => key },
	t: (key: string) => key,
}));
mock.module("~/utils/settings/helper", () => ({
	getSettings: async () => settings,
	listenSettings: () => () => {},
}));
mock.module("~/utils/storage", () => ({
	createLRUStorage: () => fakeCache,
}));
mock.module("~/utils/async/queue-hub", () => ({
	createQueueHub: () => ({
		queue: () => spyQueue,
		refresh: () => {},
		subscribe: async function* subscribe() {},
	}),
}));
// No network in tests: a missing segment is "translated" by a stub.
mock.module("~/utils/translate", () => ({
	translate: async (
		_apiSpec: string,
		_config: unknown,
		params: { text: string[] },
	) => ({ translatedText: params.text.map(fresh) }),
}));

const { createTranslateService } = await import(
	"~/entrypoints/background/services/translate"
);
const { computeCacheKey } = await import("~/utils/hasher");
const { generateDefaultSettings } = await import("~/utils/settings/default");

const buildSettings = () => {
	const next = generateDefaultSettings();
	next.queue.cacheSize = entries.size;
	return next;
};

let unary: Awaited<ReturnType<typeof createTranslateService>>["unary"];
const seed = async (texts: string[]) => {
	for (const text of texts) {
		const key = await computeCacheKey(PROMPT, MODEL, text, ctx, SRC, DST);
		await fakeCache.set(key, { output: cached(text) });
	}
};
const options = (overrides: Partial<{ cleanCache: boolean }> = {}) => ({
	modelId: MODEL,
	promptId: PROMPT,
	srcLang: SRC,
	dstLang: DST,
	thinCache: true,
	...overrides,
});

beforeEach(async () => {
	enqueued.length = 0;
	cacheCalls.get = 0;
	await fakeCache.clear();
	settings = buildSettings();
	unary = (await createTranslateService()).unary;
});

test("a fully cached batch never enters the model queue", async () => {
	await seed(segments);

	const response = await unary(ctx, options(), segments);

	expect(response.output).toEqual(segments.map(cached));
	expect(enqueued).toEqual([]);
});

test("a batch with any uncached segment goes through the queue", async () => {
	await seed(segments.slice(0, 7));

	const response = await unary(ctx, options(), segments);

	expect(enqueued).toEqual(["unary"]);
	// The cached positions are kept, the missing one is translated.
	expect(response.output).toEqual([
		...segments.slice(0, 7).map(cached),
		fresh(segments[7]),
	]);
	// ...and the freshly translated position is now cached as well.
	const key = await computeCacheKey(PROMPT, MODEL, segments[7], ctx, SRC, DST);
	expect(await fakeCache.get(key)).toEqual({ output: fresh(segments[7]) });
});

test("cleanCache always goes through the queue and re-translates", async () => {
	await seed(segments);

	const response = await unary(ctx, options({ cleanCache: true }), segments);

	expect(enqueued).toEqual(["unary"]);
	expect(response.output).toEqual(segments.map(fresh));

	// The re-translation replaced the cached entries, so the next visit is a
	// plain hit that never touches the queue again.
	const again = await unary(ctx, options(), segments);
	expect(again.output).toEqual(segments.map(fresh));
	expect(enqueued).toEqual(["unary"]);
});

test("a whole-batch cache hit is served without the queue too", async () => {
	// The non-thin shape: a single payload, one cache entry.
	const key = await computeCacheKey(
		PROMPT_ID.summary,
		MODEL,
		"text",
		ctx,
		SRC,
		DST,
	);
	await fakeCache.set(key, { output: "cached summary", reasoning: "thought" });

	const response = await unary(
		ctx,
		{ modelId: MODEL, promptId: PROMPT_ID.summary, srcLang: SRC, dstLang: DST },
		"text",
	);

	expect(response.output).toBe("cached summary");
	expect(response.reasoning).toBe("thought");
	expect(enqueued).toEqual([]);
});
