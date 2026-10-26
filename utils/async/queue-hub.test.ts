import { expect, test } from "bun:test";
import type { TranslateQueueStatus } from "~/utils/types";
import type {
	ModelQueue,
	QueueLimits,
	StreamRunner,
	UnaryRunner,
} from "../flow-control/model-queue";
import type { StreamChunk } from "../llm/types";
import { createQueueHub } from "./queue-hub";

test("subscribe yields initial status and subsequent updates", async () => {
	const limits: QueueLimits = {
		requestConcurrency: 1,
		tokensPerMinute: 10,
	};
	const baseStatus: TranslateQueueStatus = {
		modelId: "demo",
		queued: 0,
		running: 0,
		tokensAvailable: 10,
		tokensPerMinute: 10,
		requestConcurrency: 1,
	};

	let capturedNotify: ((status: TranslateQueueStatus) => void) | undefined;
	const fakeQueue: ModelQueue = {
		updateLimits: () => {},
		status: () => baseStatus,
		enqueueUnary: async <T>(
			_runner: UnaryRunner<T>,
			_estimatedTokens: number,
		) => "noop" as T,
		enqueueStream: async (_runner: StreamRunner, _estimatedTokens: number) =>
			(async function* generator(): AsyncGenerator<StreamChunk> {})(),
	};

	const hub = createQueueHub(() => limits, {
		createQueue: (_modelId, _queueLimits, notify) => {
			capturedNotify = notify;
			return fakeQueue;
		},
	});

	const subscription = hub.subscribe("demo");
	const first = await subscription.next();
	expect(first.value).toEqual(baseStatus);

	capturedNotify?.({ ...baseStatus, queued: 2 });
	const update = await subscription.next();
	expect(update.value?.queued).toBe(2);

	await subscription.return?.(undefined);
});

test("independent callers share a model queue, while distinct model ids are isolated", async () => {
	const hub = createQueueHub(() => ({
		requestConcurrency: 1,
		tokensPerMinute: 1000,
	}));
	const callerA = hub.queue("same-model");
	const callerB = hub.queue("same-model");
	expect(callerA).toBe(callerB);
	const first = Promise.withResolvers<{
		value: string;
		completionTokens: number;
	}>();
	const a = callerA.enqueueUnary(() => first.promise, 10);
	let secondStarted = false;
	const b = callerB.enqueueUnary(async () => {
		secondStarted = true;
		return { value: "b", completionTokens: 0 };
	}, 10);
	const other = hub.queue("different-model");
	expect(
		await other.enqueueUnary(
			async () => ({ value: "other", completionTokens: 0 }),
			10,
		),
	).toBe("other");
	expect(secondStarted).toBe(false);
	expect(callerA.status()).toMatchObject({ running: 1, queued: 1 });
	first.resolve({ value: "a", completionTokens: 0 });
	expect(await Promise.all([a, b])).toEqual(["a", "b"]);
	expect(callerA.status()).toMatchObject({ running: 0, queued: 0 });
});
