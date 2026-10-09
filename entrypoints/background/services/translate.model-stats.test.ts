import { beforeEach, expect, mock, test } from "bun:test";
import { PROMPT_ID } from "~/utils/constants";
import type {
	ChatRequest,
	ChatResponse,
	EndResponse,
	LLMClient,
	StreamChunk,
} from "~/utils/llm";
import type { SettingsSchema } from "~/utils/settings";
import type { TranslateContext } from "~/utils/types";

/**
 * Regression tests for per-model performance statistics.
 *
 * The translation service is the only layer that knows which configured model
 * a request belongs to, so these tests drive real unary and streaming
 * translations against a fake LLM client and assert what reaches storage:
 * token usage, the TPS generation window and streamed first-token latency.
 */

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID = "22222222-2222-4222-8222-222222222222";
const SRC = "en";
const DST = "zh-CN";
const ctx: TranslateContext = {
	page: { url: "https://example.com/a", domain: "example.com", title: "t" },
	pageContext: "[zh] page context",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- browser.storage.local and the translation result cache ---

const statsStore: Record<string, unknown> = {};
const cacheEntries = new Map<string, { output: unknown; reasoning?: string }>();
const keyOf = (key: ArrayBuffer) =>
	Array.from(new Uint8Array(key))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
const fakeCache = {
	get: async (key: ArrayBuffer) => cacheEntries.get(keyOf(key)),
	set: async (key: ArrayBuffer, value: { output: unknown }) => {
		cacheEntries.set(keyOf(key), value);
	},
	del: async (key: ArrayBuffer) => {
		cacheEntries.delete(keyOf(key));
	},
	clear: async () => cacheEntries.clear(),
	close: () => {},
	resize: () => {},
	stats: async () => ({
		entries: cacheEntries.size,
		bytes: 0,
		maxSize: 0,
		oldestUsedAt: 0,
	}),
};

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
					for (const key of Array.isArray(keys) ? keys : [keys]) {
						delete statsStore[key];
					}
				},
			},
		},
	},
}));
mock.module("~/utils/i18n", () => ({
	i18n: { t: (key: string) => key },
	t: (key: string) => key,
}));
mock.module("~/utils/storage", () => ({
	createLRUStorage: () => fakeCache,
}));
// Runs queued work immediately, so timing in the fake client is the only
// latency the measurement sees.
mock.module("~/utils/async/queue-hub", () => ({
	createQueueHub: () => ({
		queue: () => ({
			modelId: MODEL_ID,
			updateLimits: () => {},
			status: () => ({
				modelId: MODEL_ID,
				queued: 0,
				running: 0,
				tokensAvailable: 0,
				tokensPerMinute: 0,
				requestConcurrency: 0,
			}),
			enqueueUnary: async (runner: () => Promise<{ value: unknown }>) =>
				(await runner()).value,
			enqueueStream: async (
				runner: () => Promise<{ iterator: AsyncGenerator<StreamChunk> }>,
			) => (await runner()).iterator,
		}),
		refresh: () => {},
		subscribe: async function* subscribe() {},
	}),
}));

// --- fake LLM client ---

type ChatHandler = (request: ChatRequest) => Promise<ChatResponse<string>>;
type StreamHandler = (
	request: ChatRequest,
) => AsyncGenerator<StreamChunk, EndResponse>;

const defaultChatHandler: ChatHandler = async () => ({
	output: "译文",
	content: "译文",
	usage: {
		promptTokens: 7,
		completionTokens: 3,
		totalTokens: 10,
		cachedTokens: 2,
	},
});
const defaultStreamHandler: StreamHandler = async function* () {
	yield { content: "译" };
	return { usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 } };
};

let chatHandler: ChatHandler = defaultChatHandler;
let streamHandler: StreamHandler = defaultStreamHandler;

const fakeClient = {
	listModels: async () => [],
	chat: (request: ChatRequest) => chatHandler(request),
	chatStream: (request: ChatRequest) => streamHandler(request),
} as unknown as LLMClient;

mock.module("~/utils/llm", () => ({ createLLMClient: () => fakeClient }));

// --- settings ---

const buildSettings = (): SettingsSchema => {
	const next = generateDefaultSettings();
	next.services[SERVICE_ID] = {
		type: "llm",
		name: "Test LLM",
		apiSpec: "openai",
		apiKey: "test-key",
		models: { [MODEL_ID]: { name: "test-model" } },
	};
	return next;
};

let settings: SettingsSchema | undefined;
mock.module("~/utils/settings/helper", () => ({
	getSettings: async () => settings,
	listenSettings: () => () => {},
}));

const { createTranslateService } = await import(
	"~/entrypoints/background/services/translate"
);
const { generateDefaultSettings } = await import("~/utils/settings/default");
const { getTranslationStats, modelFirstTokenLatency, modelThroughput } =
	await import("~/utils/translation-stats");

/** Statistics writes are fire-and-forget, so poll until the record lands. */
const readModelEntry = async (modelId: string) => {
	for (let attempt = 0; attempt < 200; attempt++) {
		const stats = await getTranslationStats();
		const entry = stats.models[modelId];
		if (entry && entry.requests > 0) return { stats, entry };
		await sleep(1);
	}
	throw new Error("model statistics were never recorded");
};

beforeEach(() => {
	for (const key of Object.keys(statsStore)) delete statsStore[key];
	cacheEntries.clear();
	chatHandler = defaultChatHandler;
	streamHandler = defaultStreamHandler;
	settings = buildSettings();
});

test("records a unary request under the configured model", async () => {
	const { unary } = await createTranslateService();

	await unary(
		ctx,
		{
			modelId: MODEL_ID,
			promptId: PROMPT_ID.translate,
			srcLang: SRC,
			dstLang: DST,
		},
		"Hello",
	);

	const { stats, entry } = await readModelEntry(MODEL_ID);
	expect(stats.llmRequests).toBe(1);
	expect(entry.label).toBe("Test LLM / test-model");
	expect(entry.requests).toBe(1);
	expect(entry.promptTokens).toBe(7);
	expect(entry.completionTokens).toBe(3);
	expect(entry.totalTokens).toBe(10);
	expect(entry.cachedTokens).toBe(2);
	// The request is in the performance window, but a unary response never
	// reveals a first token, so it carries no TTFT sample.
	expect(entry.recent).toHaveLength(1);
	expect(entry.recent[0].ttftMs).toBeUndefined();
	expect(modelFirstTokenLatency(entry)).toEqual({ value: null, samples: 0 });
	// TPS is still measurable, over the whole call.
	expect(modelThroughput(entry).samples).toBe(1);
	expect(modelThroughput(entry).value).toBeGreaterThan(0);
});

test("samples first-token latency and generation window for a stream", async () => {
	streamHandler = async function* () {
		await sleep(20);
		yield { content: "你" };
		await sleep(20);
		yield { content: "好" };
		return { usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 } };
	};
	const { stream } = await createTranslateService();

	for await (const chunk of stream(
		ctx,
		{
			modelId: MODEL_ID,
			promptId: PROMPT_ID.summary,
			srcLang: SRC,
			dstLang: DST,
		},
		"Hello world",
	)) {
		void chunk;
	}

	const { entry } = await readModelEntry(MODEL_ID);
	expect(entry.requests).toBe(1);
	expect(entry.promptTokens).toBe(5);
	expect(entry.completionTokens).toBe(2);
	expect(entry.totalTokens).toBe(7);
	// The generator waits before its first chunk, so TTFT covers that wait.
	expect(entry.recent).toHaveLength(1);
	expect(entry.recent[0].ttftMs).toBeGreaterThanOrEqual(15);
	expect(modelFirstTokenLatency(entry)).toMatchObject({ samples: 1 });
	// The two chunks are spaced apart, so the generation window is non-zero
	// and the derived speed is a real measurement.
	expect(entry.recent[0].generationMs).toBeGreaterThanOrEqual(15);
	expect(modelThroughput(entry)).toMatchObject({ samples: 1 });
	expect(modelThroughput(entry).value).toBeGreaterThan(0);
});
