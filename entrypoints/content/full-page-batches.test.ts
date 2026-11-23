import { expect, test } from "bun:test";
import { createRoot } from "solid-js";
import type { DOMSection } from "~/utils/parser/types";
import type { TranslationResponse } from "~/utils/translation-result";
import { createFullPageBatches, type FullPageBatch } from "./full-page-batches";

function section(text: string): DOMSection {
	const p = document.createElement("p");
	const source = document.createTextNode(text);
	p.append(source);
	document.body.append(p);
	return [source, source];
}

const limits = {
	requestConcurrency: 1,
	maxBatchSize: 2,
	maxTokensPerBatch: 4,
	tokensPerMinute: 1000,
};

test("later cache hits render while a model slot is busy, then misses resume in order", async () => {
	const cached = Promise.withResolvers<FullPageBatch>();
	const resumed = Promise.withResolvers<FullPageBatch>();
	const published: FullPageBatch[] = [];
	const stop = createRoot((dispose) => {
		const queue = createFullPageBatches(
			limits,
			(batch) => {
				published.push(batch);
				if (published.length === 2) cached.resolve(batch);
				if (published.length === 3) resumed.resolve(batch);
			},
			() => {},
			async (texts) =>
				texts[0] === "hit" ? { output: ["cached"], skipped: false } : null,
		);
		for (const text of ["aaaaaaaa", "bbbbbbbb", "longer-than-budget", "hit"])
			queue.add(section(text));
		return dispose;
	});
	try {
		const hit = await cached.promise;
		expect(published[0].sections().map((pair) => pair[1])).toEqual([
			"aaaaaaaa",
			"bbbbbbbb",
		]);
		expect(hit.takeCached()?.output).toEqual(["cached"]);
		expect(hit.takeCached()).toBeUndefined();
		published[0].settled();
		expect((await resumed.promise).sections().map((pair) => pair[1])).toEqual([
			"longer-than-budget",
		]);
	} finally {
		stop();
	}
});

test("disposing during a cache probe cancels it and discards its late response", async () => {
	const started = Promise.withResolvers<AbortSignal>();
	const reply = Promise.withResolvers<TranslationResponse<string[]>>();
	const published: FullPageBatch[] = [];
	const stop = createRoot((dispose) => {
		const queue = createFullPageBatches(
			{ ...limits, maxBatchSize: 1 },
			(batch) => published.push(batch),
			() => {},
			async (texts, signal) => {
				if (texts[0] === "first") return null;
				started.resolve(signal);
				return reply.promise;
			},
		);
		for (const text of ["first", "pending", "next"]) queue.add(section(text));
		return dispose;
	});
	const signal = await started.promise;
	stop();
	expect(signal.aborted).toBe(true);
	reply.resolve({ output: ["late"], skipped: false });
	await reply.promise;
	expect(published).toHaveLength(1);
});

test("a round of lookups is as wide as the request concurrency and mounts its hits together", async () => {
	const texts = ["a", "b", "c", "d", "e"];
	const updates: string[][] = [];
	let mounted: string[] = [];
	let inFlight = 0;
	let widest = 0;
	const done = Promise.withResolvers<void>();
	const stop = createRoot((dispose) => {
		const queue = createFullPageBatches(
			{ ...limits, requestConcurrency: 2, maxBatchSize: 1 },
			(batch) => {
				// Publications of one round share a task; group them by microtask.
				if (!mounted.length)
					queueMicrotask(() => {
						updates.push(mounted);
						mounted = [];
						if (updates.flat().length === texts.length) done.resolve();
					});
				mounted.push(batch.sections()[0][1]);
			},
			() => {},
			async (batchTexts) => {
				widest = Math.max(widest, ++inFlight);
				await new Promise((resolve) => setTimeout(resolve, 1));
				inFlight--;
				return { output: batchTexts, skipped: false };
			},
		);
		for (const text of texts) queue.add(section(text));
		return dispose;
	});
	try {
		await done.promise;
		expect(widest).toBe(2);
		expect(updates).toEqual([["a", "b"], ["c", "d"], ["e"]]);
	} finally {
		stop();
	}
});
