import { expect, test } from "bun:test";
import type { UnaryResult } from "./model-queue";
import { createModelQueue } from "./model-queue";

const createLimits = () => ({
	requestConcurrency: 1,
	tokensPerMinute: 1000,
	maxBatchSize: 10,
});

test("runs unary tasks sequentially when concurrency is one", async () => {
	const queue = createModelQueue("model", createLimits(), () => {});
	let releaseFirst: (() => void) | undefined;
	let firstDone = false;

	const first = queue.enqueueUnary(async (): Promise<UnaryResult<string>> => {
		return await new Promise((resolve) => {
			releaseFirst = () => {
				firstDone = true;
				resolve({ value: "first", completionTokens: 0 });
			};
		});
	}, 10);

	const second = queue.enqueueUnary(async (): Promise<UnaryResult<string>> => {
		if (!firstDone) {
			throw new Error("Second task started before first completed");
		}
		return { value: "second", completionTokens: 0 };
	}, 10);

	expect(releaseFirst).toBeDefined();
	releaseFirst?.();

	const firstValue = await first;
	expect(firstValue).toBe("first");
	const secondValue = await second;
	expect(secondValue).toBe("second");
});

test("handles stream tasks and completes after iterator finishes", async () => {
	const queue = createModelQueue("model", createLimits(), () => {});
	const iterator = await queue.enqueueStream(async () => {
		async function* chunks() {
			yield { content: "a" };
			yield { content: "b" };
		}
		return { iterator: chunks(), completion: Promise.resolve(2) };
	}, 10);

	const first = await iterator.next();
	expect(first).toEqual({ value: { content: "a" }, done: false });
	const second = await iterator.next();
	expect(second).toEqual({ value: { content: "b" }, done: false });
	const end = await iterator.next();
	expect(end.done).toBe(true);
});

const unaryResult = (value = "ok"): UnaryResult<string> => ({
	value,
	completionTokens: 0,
});

test("cancelling a queued task removes it without spending tokens or running it", async () => {
	const queue = createModelQueue("model", createLimits(), () => {});
	const first = Promise.withResolvers<UnaryResult<string>>();
	const running = queue.enqueueUnary(() => first.promise, 10);
	const controller = new AbortController();
	let called = false;
	const cancelled = queue
		.enqueueUnary(
			async () => {
				called = true;
				return unaryResult();
			},
			100,
			controller.signal,
		)
		.catch((error) => error);
	expect(queue.status()).toMatchObject({ running: 1, queued: 1 });
	controller.abort();
	expect((await cancelled).name).toBe("AbortError");
	expect(queue.status()).toMatchObject({ running: 1, queued: 0 });
	first.resolve(unaryResult());
	await running;
	expect(called).toBe(false);
	expect(queue.status().running).toBe(0);
	expect(queue.status().tokensAvailable).toBeGreaterThanOrEqual(990);
});

test("already aborted tasks never enter either queue", async () => {
	const queue = createModelQueue("model", createLimits(), () => {});
	const controller = new AbortController();
	controller.abort();
	let called = false;
	const run = () => {
		called = true;
		throw new Error("unexpected execution");
	};
	await expect(
		queue.enqueueUnary(run, 10, controller.signal),
	).rejects.toThrow();
	await expect(
		queue.enqueueStream(run, 10, controller.signal),
	).rejects.toThrow();
	expect(called).toBe(false);
	expect(queue.status()).toMatchObject({ queued: 0, running: 0 });
});

test("cancelling a token-blocked head lets the next request run", async () => {
	const queue = createModelQueue("model", createLimits(), () => {});
	const controller = new AbortController();
	const blocked = queue
		.enqueueStream(
			async () => {
				throw new Error("must not run");
			},
			2000,
			controller.signal,
		)
		.catch((error) => error);
	const next = queue.enqueueUnary(async () => unaryResult(), 10);
	expect(queue.status().queued).toBe(2);
	controller.abort();
	await blocked;
	expect(await next).toBe("ok");
	expect(queue.status()).toMatchObject({ queued: 0, running: 0 });
});

test.each(["unary", "stream"] as const)(
	"a synchronous %s runner error frees its slot",
	async (kind) => {
		const queue = createModelQueue("model", createLimits(), () => {});
		const run = () => {
			throw new Error("synchronous failure");
		};
		const failed =
			kind === "unary"
				? queue.enqueueUnary(run, 10)
				: queue.enqueueStream(run, 10);
		const next = queue.enqueueUnary(async () => unaryResult(), 10);
		await expect(failed).rejects.toThrow("synchronous failure");
		expect(await next).toBe("ok");
		expect(queue.status()).toMatchObject({ queued: 0, running: 0 });
	},
);

test("closing an unstarted stream frees its slot exactly once", async () => {
	const queue = createModelQueue("model", createLimits(), () => {});
	const completion = Promise.withResolvers<number>();
	const iterator = await queue.enqueueStream(
		async () => ({
			iterator: (async function* () {
				yield { content: "unused" };
			})(),
			completion: completion.promise,
		}),
		10,
	);
	const second = Promise.withResolvers<UnaryResult<string>>();
	const next = queue.enqueueUnary(() => second.promise, 10);
	expect(queue.status()).toMatchObject({ queued: 1, running: 1 });
	await iterator.return(undefined);
	expect(queue.status()).toMatchObject({ queued: 0, running: 1 });
	completion.resolve(0);
	await completion.promise;
	expect(queue.status().running).toBe(1);
	second.resolve(unaryResult());
	await next;
	expect(queue.status().running).toBe(0);
});

test("mixed unary and stream tasks share slots until streaming completes", async () => {
	const queue = createModelQueue(
		"model",
		{ ...createLimits(), requestConcurrency: 2 },
		() => {},
	);
	const completion = Promise.withResolvers<number>();
	const iterator = await queue.enqueueStream(
		async () => ({
			iterator: (async function* () {
				yield { content: "stream" };
			})(),
			completion: completion.promise,
		}),
		10,
	);
	const first = Promise.withResolvers<UnaryResult<string>>();
	const unary = queue.enqueueUnary(() => first.promise, 10);
	let started = false;
	const next = queue.enqueueUnary(async () => {
		started = true;
		return unaryResult();
	}, 10);
	expect(queue.status()).toMatchObject({ queued: 1, running: 2 });
	await iterator.next();
	expect(started).toBe(false);
	completion.resolve(0);
	await next;
	expect(queue.status().running).toBe(1);
	await iterator.return(undefined);
	expect(queue.status().running).toBe(1);
	first.resolve(unaryResult());
	await unary;
	expect(queue.status().running).toBe(0);
});

test("lowering concurrency waits for existing tasks without freeing them early", async () => {
	const queue = createModelQueue(
		"model",
		{ ...createLimits(), requestConcurrency: 2 },
		() => {},
	);
	const gates = [
		Promise.withResolvers<UnaryResult<string>>(),
		Promise.withResolvers<UnaryResult<string>>(),
	];
	const running = gates.map((gate) =>
		queue.enqueueUnary(() => gate.promise, 10),
	);
	queue.updateLimits(createLimits());
	let started = false;
	const next = queue.enqueueUnary(async () => {
		started = true;
		return unaryResult();
	}, 10);
	gates[0].resolve(unaryResult());
	await running[0];
	expect(started).toBe(false);
	expect(queue.status()).toMatchObject({ queued: 1, running: 1 });
	gates[1].resolve(unaryResult());
	await Promise.all([...running, next]);
	expect(started).toBe(true);
	expect(queue.status()).toMatchObject({ queued: 0, running: 0 });
});
