import { expect, test } from "bun:test";
import { createModelQueue, type UnaryRunner } from "./model-queue";

/**
 * Why `unary()` must not send cache hits through the model queue.
 *
 * The queue has no notion of free work: every task it admits — including one
 * that turns out to be a cache hit — has to buy `estimatedTokens` from the same
 * token bucket real API calls spend. Real traffic drives that bucket below zero
 * (the queue force-consumes the token overage without clamping), so a page that
 * is served entirely from the cache then waits for the refill.
 *
 * These tests pin that contract down: they describe the queue, not the fix. The
 * behaviour that depends on it — a cache hit never entering the queue — is
 * covered by `entrypoints/background/services/translate.cache-hit.test.ts`.
 *
 * Durations are virtual milliseconds: the clock is simulated, so the numbers
 * describe the algorithm and the test still runs in milliseconds of real time.
 */

type Clock = {
	now: number;
	timers: Array<{ at: number; fn: () => void }>;
	setTimeout: (fn: () => void, ms: number) => unknown;
	runUntil: (isDone: () => boolean, maxIterations?: number) => Promise<void>;
};

const withVirtualClock = async (body: (clock: Clock) => Promise<void>) => {
	const realSetTimeout = globalThis.setTimeout;
	const realDateNow = Date.now;
	// The token bucket refills from Date.now(), so the virtual clock has to cover
	// the queue's timers *and* the wall clock the bucket reads.
	Date.now = () => clock.now;
	const clock: Clock = {
		now: 1_700_000_000_000,
		timers: [],
		setTimeout(fn, ms) {
			clock.timers.push({ at: clock.now + Math.max(0, ms), fn });
			return 0 as unknown as ReturnType<typeof setTimeout>;
		},
		async runUntil(isDone, maxIterations = 4000) {
			// Yield to real microtasks between virtual timer firings: the queue
			// settles its promises and starts the next task from there.
			const tick = () => new Promise((resolve) => realSetTimeout(resolve, 0));
			for (let i = 0; i < maxIterations && !isDone(); i++) {
				if (clock.timers.length > 0) {
					clock.timers.sort((a, b) => a.at - b.at);
					const next = clock.timers.shift();
					if (next) clock.now = Math.max(clock.now, next.at);
					next?.fn();
				}
				await tick();
				if (clock.timers.length === 0 && !isDone()) {
					await tick();
					if (clock.timers.length === 0) return; // nothing left to fire
				}
			}
		},
	};
	globalThis.setTimeout = clock.setTimeout as unknown as typeof setTimeout;
	try {
		await body(clock);
	} finally {
		globalThis.setTimeout = realSetTimeout;
		Date.now = realDateNow;
	}
};

/** A batch served from the cache: no API call, no tokens spent. */
const cacheHit: UnaryRunner<unknown> = async () => ({
	value: [],
	completionTokens: 0,
});

/** A real batch that fails: its estimate is spent, its tokens are not. */
const failingRequest: UnaryRunner<unknown> = async () => {
	throw new Error("upstream");
};

/**
 * A real LLM batch. The estimate counts the payload only, while the API reports
 * the whole conversation — system prompt, page context, history — as usage, so a
 * batch routinely "over-reports" by thousands of tokens.
 */
const llmRequest =
	(totalTokens: number): UnaryRunner<unknown> =>
	async () => {
		await new Promise((resolve) => setTimeout(resolve, 2000));
		return { value: null, completionTokens: totalTokens };
	};

test("real traffic spends the bucket and even drives it below zero", async () => {
	await withVirtualClock(async (clock) => {
		const queue = createModelQueue(
			"model",
			{ requestConcurrency: 4, tokensPerMinute: 60_000 },
			() => {},
		);

		let drained = 0;
		void Array.from({ length: 10 }, () =>
			queue
				.enqueueUnary(failingRequest, 6500)
				.catch(() => {})
				.then(() => {
					drained++;
				}),
		);
		await clock.runUntil(() => drained === 10);

		expect(drained).toBe(10);
		// Reported as empty. `consume()` never overdraws, so the balance only
		// ever reaches zero from here — the overage a batch reports on completion
		// is charged on top of it (see the test below).
		expect(queue.status().tokensAvailable).toBe(0);
	});
});

test("an enqueued cache hit waits for the token refill", async () => {
	await withVirtualClock(async (clock) => {
		const queue = createModelQueue(
			"model",
			{ requestConcurrency: 4, tokensPerMinute: 60_000 },
			() => {},
		);

		// A page of real requests first.
		let drained = 0;
		void Array.from({ length: 10 }, () =>
			queue
				.enqueueUnary(failingRequest, 6500)
				.catch(() => {})
				.then(() => {
					drained++;
				}),
		);
		await clock.runUntil(() => drained === 10);

		// Fifteen batches that are all cached: zero cost, but still throttled.
		const startedAt = clock.now;
		let served = 0;
		void Array.from({ length: 15 }, () =>
			queue.enqueueUnary(cacheHit, 600).then(() => {
				served++;
			}),
		);
		await clock.runUntil(() => served === 15);

		expect(served).toBe(15);
		// Tens of seconds, for work that costs nothing — which is exactly why the
		// translation service reads the cache before entering this queue.
		expect(clock.now - startedAt).toBeGreaterThan(5000);
	});
});

test("LLM usage that over-reports cannot pile up unbounded debt", async () => {
	await withVirtualClock(async (clock) => {
		const queue = createModelQueue(
			"model",
			{ requestConcurrency: 4, tokensPerMinute: 60_000 },
			() => {},
		);

		// One page of real LLM batches: estimated at 600 tokens each, reporting
		// 6000 tokens of actual usage. The overage is charged on completion.
		let done = 0;
		void Array.from({ length: 15 }, () =>
			queue
				.enqueueUnary(llmRequest(6000), 600)
				.catch(() => {})
				.then(() => {
					done++;
				}),
		);
		await clock.runUntil(() => done === 15);
		expect(done).toBe(15);

		// The next request only waits for its own tokens: the debt the overage
		// created is bounded by the bucket's floor. Before the clamp it waited for
		// the whole accumulated overage — half a minute for this page alone.
		const startedAt = clock.now;
		let served = 0;
		void queue.enqueueUnary(cacheHit, 600).then(() => {
			served++;
		});
		await clock.runUntil(() => served === 1);

		expect(served).toBe(1);
		expect(clock.now - startedAt).toBeLessThanOrEqual(600);
	});
});
