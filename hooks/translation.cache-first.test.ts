import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import { PROMPT_ID } from "~/utils/constants";

mock.module("~/utils/i18n", () => ({ t: (key: string) => key }));
mock.module("~/hooks/progress-indicator", () => ({
	mightUseProgressIndicator: () => undefined,
}));

const { createBatchTranslation } = await import("./translation");
const disposers: (() => void)[] = [];
const cachedUnary = mock(async (..._args: unknown[]): Promise<unknown> => null);
const unary = mock(async (..._args: unknown[]) => ({
	output: ["fresh translation"],
	skipped: false,
}));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	cachedUnary.mockReset();
	cachedUnary.mockResolvedValue(null);
	unary.mockReset();
	unary.mockResolvedValue({ output: ["fresh translation"], skipped: false });
	Object.assign(globalThis, { window: { rpc: { cachedUnary, unary } } });
});

afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
});

const start = (
	beforeTranslate: () => Promise<unknown>,
	overrides: Partial<Parameters<typeof createBatchTranslation>[1]> = {},
) => {
	let result!: ReturnType<typeof createBatchTranslation>;
	createRoot((dispose) => {
		disposers.push(dispose);
		result = createBatchTranslation(() => ["Original paragraph"], {
			promptId: PROMPT_ID.batchTranslate,
			modelId: () => "model-1",
			srcLang: () => "en",
			dstLang: () => "zh-CN",
			ctx: () => ({ page: { domain: "example.com" } }),
			beforeTranslate,
			...overrides,
		});
	});
	return result;
};

test("cached translations render without starting or waiting for context", async () => {
	cachedUnary.mockResolvedValue({
		output: ["cached translation"],
		skipped: false,
	});
	const prepare = mock(() => new Promise(() => {}));
	const [read] = start(prepare);
	await flush();

	expect(read()[0]()).toBe("cached translation");
	expect(read()[0].loading).toBe(false);
	expect(cachedUnary).toHaveBeenCalledTimes(1);
	expect(prepare).not.toHaveBeenCalled();
	expect(unary).not.toHaveBeenCalled();
});

test("a miss waits for context and sends it with the actual translation", async () => {
	const context = Promise.withResolvers<void>();
	const [hint, setHint] = createSignal<string>();
	const prepare = mock(async () => {
		await context.promise;
		setHint("prepared page context");
	});
	const [read] = start(prepare, {
		ctx: () => ({ pageContext: hint() }),
	});
	await flush();
	expect(prepare).toHaveBeenCalledTimes(1);
	expect(unary).not.toHaveBeenCalled();
	expect(read()[0].loading).toBe(true);

	context.resolve();
	await flush();
	expect(read()[0]()).toBe("fresh translation");
	expect(unary).toHaveBeenCalledTimes(1);
	expect(unary.mock.calls[0][0]).toEqual({
		pageContext: "prepared page context",
	});
	// Publishing the context does not restart the batch or erase its result.
	setHint("updated hint");
	await flush();
	expect(cachedUnary).toHaveBeenCalledTimes(1);
	expect(unary).toHaveBeenCalledTimes(1);
	expect(read()[0]()).toBe("fresh translation");
});

test("same-language batches skip both the cache RPC and context generation", async () => {
	const prepare = mock(async () => {});
	const [read] = start(prepare, { srcLang: () => "zh-CN" });
	await flush();
	expect(read()[0].skipped).toBe(true);
	expect(read()[0].loading).toBe(false);
	expect(cachedUnary).not.toHaveBeenCalled();
	expect(prepare).not.toHaveBeenCalled();
	expect(unary).not.toHaveBeenCalled();
});

test("retrying a cached batch prepares context and forces a fresh translation", async () => {
	cachedUnary.mockResolvedValue({
		output: ["cached translation"],
		skipped: false,
	});
	const prepare = mock(async () => {});
	const [read, retry] = start(prepare);
	await flush();
	retry();
	await flush();
	expect(prepare).toHaveBeenCalledTimes(1);
	expect(cachedUnary).toHaveBeenCalledTimes(1);
	expect(unary.mock.calls[0][1]).toMatchObject({ cleanCache: true });
	expect(read()[0]()).toBe("fresh translation");
});

test("retrying one cached segment also prepares context before retranslation", async () => {
	cachedUnary.mockResolvedValue({
		output: ["cached translation"],
		skipped: false,
	});
	const context = Promise.withResolvers<void>();
	const prepare = mock(() => context.promise);
	const [read, retry] = start(prepare);
	await flush();
	retry(0);
	await flush();
	expect(prepare).toHaveBeenCalledTimes(1);
	expect(unary).not.toHaveBeenCalled();
	context.resolve();
	await flush();
	expect(unary.mock.calls[0][1]).toMatchObject({ cleanCache: true });
	expect(unary.mock.calls[0][2]).toBe("Original paragraph");
	expect(read()[0]()).toBe("fresh translation");
});

test("unmounting while context is pending prevents a late translation", async () => {
	const context = Promise.withResolvers<void>();
	const prepare = mock(() => context.promise);
	start(prepare);
	await flush();
	expect(prepare).toHaveBeenCalledTimes(1);
	disposers.pop()?.();
	context.resolve();
	await flush();
	expect(unary).not.toHaveBeenCalled();
});

test("a late cache response cannot overwrite a new target language", async () => {
	const first = Promise.withResolvers<unknown>();
	cachedUnary.mockImplementationOnce(() => first.promise);
	cachedUnary.mockResolvedValue({
		output: ["French translation"],
		skipped: false,
	});
	const [language, setLanguage] = createSignal("zh-CN");
	const [read] = start(async () => {}, { dstLang: language });
	await flush();
	setLanguage("fr");
	await flush();
	expect(read()[0]()).toBe("French translation");
	first.resolve({ output: ["Chinese translation"], skipped: false });
	await flush();
	expect(read()[0]()).toBe("French translation");
	expect(cachedUnary).toHaveBeenCalledTimes(2);
});
