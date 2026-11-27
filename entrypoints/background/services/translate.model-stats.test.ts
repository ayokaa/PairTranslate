import { beforeEach, expect, jest, mock, test } from "bun:test";
import { PROMPT_ID } from "~/utils/constants";
import { RATE_LIMIT_COOLDOWN_MS } from "~/utils/flow-control/model-queue";
import type {
	ChatRequest,
	ChatResponse,
	EndResponse,
	LLMClient,
	StreamChunk,
} from "~/utils/llm";
import { LLMError, LLMErrorType } from "~/utils/llm/types";
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
	getMany: async (keys: ArrayBuffer[]) =>
		keys.map((key) => cacheEntries.get(keyOf(key))),
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
// --- fake LLM client ---

type ChatHandler = (
	request: ChatRequest,
	schema?: unknown,
) => Promise<ChatResponse<string>>;
type StreamHandler = (
	request: ChatRequest,
	schema?: unknown,
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
	chat: (request: ChatRequest, schema?: unknown) =>
		chatHandler(request, schema),
	chatStream: (request: ChatRequest, schema?: unknown) =>
		streamHandler(request, schema),
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

test("a rate limit during stream iteration holds the model queue", async () => {
	const { stream, queueStatus } = await createTranslateService();
	const options = {
		modelId: MODEL_ID,
		promptId: PROMPT_ID.summary,
		srcLang: SRC,
		dstLang: DST,
	};
	const failure = new LLMError(LLMErrorType.RATE_LIMIT_ERROR, "rate limited");
	// biome-ignore lint/correctness/useYield: The provider rejects before sending the first chunk.
	streamHandler = async function* () {
		throw failure;
	};

	jest.useFakeTimers();
	const status = queueStatus(MODEL_ID);
	try {
		await expect(stream(ctx, options, "First request").next()).rejects.toBe(
			failure,
		);

		streamHandler = defaultStreamHandler;
		await status.next();
		const next = stream(ctx, options, "Second request");
		const chunk = next.next();
		await status.next();
		const snapshot = queueStatus(MODEL_ID);
		try {
			expect((await snapshot.next()).value).toMatchObject({
				queued: 1,
				running: 0,
			});
		} finally {
			await snapshot.return(undefined);
		}

		jest.advanceTimersByTime(RATE_LIMIT_COOLDOWN_MS);
		expect((await chunk).value).toEqual({ content: "译" });
		expect((await next.next()).done).toBe(true);
	} finally {
		await status.return(undefined);
		jest.useRealTimers();
	}
});

test("webAdaptation responses bypass translate-cache persistence", async () => {
	chatHandler = async () => ({
		output:
			'{"roots":[],"excludes":[],"includes":[],"promoteTags":[],"removeExcludes":[],"reason":"ok"}',
		content:
			'{"roots":[],"excludes":[],"includes":[],"promoteTags":[],"removeExcludes":[],"reason":"ok"}',
		reasoning: "long reasoning trace",
		usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
	});
	const { unary } = await createTranslateService();
	await unary(
		{},
		{
			modelId: MODEL_ID,
			promptId: PROMPT_ID.webAdaptation,
			srcLang: "auto",
			dstLang: DST,
		},
		'{"outline":[],"pairs":[],"untranslated":[]}',
	);
	expect(cacheEntries.size).toBe(0);
});

test("batch translation strips thinking tags, discards corrupted dividers, and returns partial results", async () => {
	let calls = 0;
	chatHandler = async () => {
		calls += 1;
		if (calls === 1) {
			return {
				output:
					"<think>internal</think>\n==== 0\n引言\n**==== 1**\n正文\n==== 2\n公司",
				content:
					"<think>internal</think>\n==== 0\n引言\n**==== 1**\n正文\n==== 2\n公司",
				usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
			};
		}
		// Recovery round resolves only the first missing item (index 0 -> orig 0)
		return {
			output: "==== 0\n干净引言",
			content: "==== 0\n干净引言",
			usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
		};
	};
	const { unary } = await createTranslateService();
	const response = await unary(
		ctx,
		{
			modelId: MODEL_ID,
			promptId: PROMPT_ID.batchTranslate,
			srcLang: SRC,
			dstLang: DST,
			thinCache: true,
		},
		["Quote", "Body paragraph", "Company"],
	);
	expect(calls).toBe(2);
	expect(response.output).toEqual(["干净引言", "", "公司"]);
	expect(response.errors?.[0]).toBeUndefined();
	expect(response.errors?.[1]).toContain("Expected 3 translations");
	expect(response.errors?.[2]).toBeUndefined();
	// Only clean segments were cached (index 0 and index 2, never the poisoned segment).
	expect(cacheEntries.size).toBe(2);
});

test("stream passes structured output schema for explain and strips thinking tags", async () => {
	let receivedSchema: unknown;
	streamHandler = async function* (_req, schema) {
		receivedSchema = schema;
		yield { content: '<think>hidden</think>{"context_explanation":"ok"}' };
		return { usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } };
	};
	const { stream } = await createTranslateService();
	let combined = "";
	for await (const chunk of stream(
		ctx,
		{
			modelId: MODEL_ID,
			promptId: PROMPT_ID.explain,
			srcLang: SRC,
			dstLang: DST,
		},
		"superposition",
	)) {
		if (chunk.content) combined += chunk.content;
	}
	expect(receivedSchema).toBeDefined();
	expect(combined).toBe('{"context_explanation":"ok"}');
});

test("oversized batch estimate is clamped to bucket capacity instead of starving the queue", async () => {
	settings!.queue.tokensPerMinute = 50;
	const { unary } = await createTranslateService();
	const response = await unary(
		ctx,
		{
			modelId: MODEL_ID,
			promptId: PROMPT_ID.translate,
			srcLang: SRC,
			dstLang: DST,
		},
		"x".repeat(400),
	);
	expect(response.output).toBe("译文");
});
