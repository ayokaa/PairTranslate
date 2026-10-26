import { createTokenBucket } from "~/utils/flow-control/token-bucket";
import type { StreamChunk } from "~/utils/llm";
import type { TranslateQueueStatus } from "~/utils/types";

export type QueueLimits = {
	requestConcurrency: number;
	tokensPerMinute: number;
};

export type UnaryResult<T> = {
	value: T;
	completionTokens: number;
};

type StreamHandle = {
	iterator: AsyncGenerator<StreamChunk>;
	completion: Promise<number>;
};

export type UnaryRunner<T> = () => Promise<UnaryResult<T>>;
export type StreamRunner = () => Promise<StreamHandle>;

type PendingTask = { stopWaiting?: () => void } & (
	| {
			kind: "unary";
			estimatedTokens: number;
			run: UnaryRunner<unknown>;
			resolve: (value: unknown) => void;
			reject: (reason: unknown) => void;
	  }
	| {
			kind: "stream";
			estimatedTokens: number;
			run: StreamRunner;
			onReady: (iterator: AsyncGenerator<StreamChunk>) => void;
			reject: (reason: unknown) => void;
	  }
);

export type ModelQueue = {
	updateLimits(next: QueueLimits): void;
	status(): TranslateQueueStatus;
	enqueueUnary<T>(
		runner: UnaryRunner<T>,
		estimatedTokens: number,
		signal?: AbortSignal,
	): Promise<T>;
	enqueueStream(
		runner: StreamRunner,
		estimatedTokens: number,
		signal?: AbortSignal,
	): Promise<AsyncGenerator<StreamChunk>>;
};

export const createModelQueue = (
	modelId: string,
	limits: QueueLimits,
	notify: (status: TranslateQueueStatus) => void,
): ModelQueue => {
	const bucket = createTokenBucket(limits.tokensPerMinute);
	const pending: PendingTask[] = [];
	let running = 0;
	let currentLimits = limits;
	let tokenTimer: ReturnType<typeof setTimeout> | undefined;

	const status = (): TranslateQueueStatus => ({
		modelId,
		queued: pending.length,
		running,
		tokensAvailable: Math.floor(bucket.available()),
		tokensPerMinute: currentLimits.tokensPerMinute,
		requestConcurrency: currentLimits.requestConcurrency,
	});

	const emit = () => {
		notify(status());
	};

	const finish = (additionalTokens: number) => {
		running = Math.max(0, running - 1);
		if (additionalTokens > 0) {
			bucket.forceConsume(additionalTokens);
		}
		emit();
		process();
	};

	const waitForTokens = (tokens: number) => {
		const delay = bucket.msUntil(tokens);
		if (tokenTimer || delay <= 0) return;
		tokenTimer = setTimeout(
			() => {
				tokenTimer = undefined;
				process();
			},
			Math.min(delay, 5000),
		);
	};

	const process = () => {
		while (pending.length > 0) {
			if (running >= currentLimits.requestConcurrency) return;
			const task = pending[0];
			if (!bucket.consume(task.estimatedTokens)) {
				waitForTokens(task.estimatedTokens);
				return;
			}

			pending.shift();
			task.stopWaiting?.();
			running += 1;
			emit();

			let finished = false;
			const finishTask = (tokens: number) => {
				if (finished) return;
				finished = true;
				finish(tokens);
			};
			// A runner can throw before returning its promise.
			const run = <T>(runner: () => Promise<T>): Promise<T> => {
				try {
					return Promise.resolve(runner());
				} catch (error) {
					return Promise.reject(error);
				}
			};
			if (task.kind === "unary") {
				run(task.run)
					.then((result) => {
						task.resolve(result.value);
						const extra = Math.max(
							0,
							(result.completionTokens ?? task.estimatedTokens) -
								task.estimatedTokens,
						);
						finishTask(extra);
					})
					.catch((error) => {
						task.reject(error);
						finishTask(0);
					});
			} else {
				run(task.run)
					.then(({ iterator, completion }) => {
						// Closing a generator before its first next() skips its finally.
						// Release the slot after close even if completion never settles.
						const close = iterator.return.bind(iterator);
						iterator.return = async (...args) => {
							try {
								return await close(...args);
							} finally {
								finishTask(0);
							}
						};
						task.onReady(iterator);
						completion
							.then((tokens) => {
								const extra = Math.max(
									0,
									(tokens ?? task.estimatedTokens) - task.estimatedTokens,
								);
								finishTask(extra);
							})
							.catch((error) => {
								task.reject(error);
								finishTask(0);
							});
					})
					.catch((error) => {
						task.reject(error);
						finishTask(0);
					});
			}
		}
	};

	const enqueue = (task: PendingTask, signal?: AbortSignal) => {
		if (signal?.aborted) {
			task.reject(signal.reason);
			return;
		}
		const cancel = () => {
			const index = pending.indexOf(task);
			if (index < 0) return;
			pending.splice(index, 1);
			task.stopWaiting?.();
			task.reject(signal?.reason);
			if (pending.length === 0 && tokenTimer) {
				clearTimeout(tokenTimer);
				tokenTimer = undefined;
			}
			emit();
			process();
		};
		task.stopWaiting = () => signal?.removeEventListener("abort", cancel);
		signal?.addEventListener("abort", cancel, { once: true });
		pending.push(task);
		emit();
		process();
	};

	return {
		updateLimits(next) {
			currentLimits = next;
			bucket.update(next.tokensPerMinute);
			emit();
			process();
		},
		status,
		enqueueUnary(runner, estimatedTokens, signal) {
			return new Promise((resolve, reject) => {
				enqueue(
					{
						kind: "unary",
						estimatedTokens,
						run: runner as UnaryRunner<unknown>,
						resolve: resolve as (value: unknown) => void,
						reject: reject as (reason: unknown) => void,
					},
					signal,
				);
			});
		},
		enqueueStream(runner, estimatedTokens, signal) {
			return new Promise((resolve, reject) => {
				enqueue(
					{
						kind: "stream",
						estimatedTokens,
						run: runner,
						onReady: resolve,
						reject: reject as (reason: unknown) => void,
					},
					signal,
				);
			});
		},
	};
};
