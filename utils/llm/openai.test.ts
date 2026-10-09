import { expect, test } from "bun:test";
import { createOpenAIClient } from "./openai";

/**
 * Regression tests for streamed completions whose usage arrives early.
 *
 * OpenAI sends usage in a final, usage-only chunk, but OpenAI-compatible
 * providers do not have to: SiliconFlow attaches a usage object to every
 * chunk. Returning as soon as a usage object is seen would end the generator
 * on the first (empty) chunk and drop the whole answer.
 */

const USAGE = {
	prompt_tokens: 9,
	completion_tokens: 4,
	total_tokens: 13,
	prompt_tokens_details: { cached_tokens: 3 },
};

const textChunk = (content: string, extra: Record<string, unknown> = {}) => ({
	id: "chunk",
	object: "chat.completion.chunk",
	created: 0,
	model: "test-model",
	choices: [{ index: 0, delta: { content }, finish_reason: null }],
	...extra,
});

const streamBody = (chunks: unknown[]) =>
	[
		...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
		"data: [DONE]\n\n",
	].join("");

const serve = async (body: string, run: (baseUrl: string) => Promise<void>) => {
	const server = Bun.serve({
		port: 0,
		fetch: () =>
			new Response(body, {
				headers: { "content-type": "text/event-stream" },
			}),
	});
	try {
		await run(`http://localhost:${server.port}/v1`);
	} finally {
		server.stop(true);
	}
};

const collectStream = async (baseUrl: string) => {
	const client = createOpenAIClient({ apiKey: "test", baseUrl });
	const stream = client.chatStream({
		model: "test-model",
		messages: [{ role: "user", content: "hi" }],
	});
	const parts: string[] = [];
	while (true) {
		const next = await stream.next();
		if (next.done) {
			return { text: parts.join(""), end: next.value };
		}
		if (next.value.content) parts.push(next.value.content);
	}
};

test("usage on every chunk does not truncate the stream", async () => {
	await serve(
		streamBody([
			textChunk("", { usage: USAGE }),
			textChunk("你好", { usage: USAGE }),
			textChunk("世界", { usage: USAGE }),
		]),
		async (baseUrl) => {
			const { text, end } = await collectStream(baseUrl);
			expect(text).toBe("你好世界");
			expect(end).toEqual({
				usage: {
					promptTokens: 9,
					completionTokens: 4,
					totalTokens: 13,
					cachedTokens: 3,
				},
			});
		},
	);
});

test("usage in a final usage-only chunk is still returned", async () => {
	await serve(
		streamBody([
			textChunk("hello"),
			{
				id: "chunk",
				object: "chat.completion.chunk",
				created: 0,
				model: "test-model",
				choices: [],
				usage: USAGE,
			},
		]),
		async (baseUrl) => {
			const { text, end } = await collectStream(baseUrl);
			expect(text).toBe("hello");
			expect(end).toEqual({
				usage: {
					promptTokens: 9,
					completionTokens: 4,
					totalTokens: 13,
					cachedTokens: 3,
				},
			});
		},
	);
});
