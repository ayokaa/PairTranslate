import { batch as batchUpdates, createSignal, onCleanup } from "solid-js";
import { getMarkdownFromSection } from "~/utils/markdown";
import { nextTask } from "~/utils/next-task";
import { isDisplayOnlyMarkdown } from "~/utils/parser/math-section";
import type { DOMSection } from "~/utils/parser/types";
import type { EffectiveQueueSettings } from "~/utils/settings/services";
import { estimateTokens } from "~/utils/token-estimate";
import type { TranslationResponse } from "~/utils/translation-result";

export type SectionTextPair = [DOMSection, string];

export interface FullPageBatch {
	sections: () => SectionTextPair[];
	takeCached: () => TranslationResponse<string[]> | undefined;
	settled: () => void;
	remove: (section: DOMSection) => void;
}

// Mount loading portals only when the model has room for another batch.
export function createFullPageBatches(
	limits: EffectiveQueueSettings,
	publish: (batch: FullPageBatch) => void,
	discard: (batch: FullPageBatch) => void,
	probe?: (
		texts: string[],
		signal: AbortSignal,
	) => Promise<TranslationResponse<string[]> | null>,
) {
	const pending = new Set<DOMSection>();
	let cursor = pending.values();
	const owners = new Map<DOMSection, FullPageBatch>();
	let carry: SectionTextPair | undefined;
	const running = new Set<FullPageBatch>();
	const misses = new Set<FullPageBatch>();
	const controller = new AbortController();
	let probing = false;

	let cancelStep: (() => void) | undefined;

	const hasRoom = () => running.size < limits.requestConcurrency;
	// With a lookup available every batch is looked up before it is mounted, so
	// reading ahead never waits for a model slot. Without one, a batch is read
	// only when it can be translated straight away.
	const canRead = () => (probe ? !probing : hasRoom());

	function schedule() {
		if (controller.signal.aborted || cancelStep) return;
		// Not a timer: a long page is often left to translate in a background
		// tab, where every timer step would wait for the next full second.
		if ((hasRoom() && misses.size) || (canRead() && (pending.size || carry)))
			cancelStep = nextTask(dispatch);
	}

	function start(batch: FullPageBatch) {
		running.add(batch);
		publish(batch);
	}

	// One step per task: resume the oldest misses there is room for, or read
	// further ahead.
	function dispatch() {
		cancelStep = undefined;
		if (misses.size && hasRoom()) {
			batchUpdates(() => {
				for (const batch of misses) {
					if (!hasRoom()) break;
					misses.delete(batch);
					start(batch);
				}
			});
		} else if (canRead()) {
			if (probe) lookAhead(probe);
			else {
				const members = readBatch();
				if (members.length) start(createBatch(members).batch);
			}
		}
		schedule();
	}

	function readBatch() {
		const members: SectionTextPair[] = [];
		let tokens = 0;
		// Stop after one batch of DOM reads even when every section is skipped.
		for (let i = 0; i < limits.maxBatchSize; i++) {
			const section = carry?.[0] ?? cursor.next().value;
			if (!section) break;
			pending.delete(section);
			const previous = carry;
			carry = undefined;
			if (
				!section[0].isConnected ||
				!section[1].isConnected ||
				section[0].parentNode !== section[1].parentNode
			)
				continue;
			const pair: SectionTextPair = previous ?? [
				section,
				getMarkdownFromSection(section),
			];
			if (isDisplayOnlyMarkdown(pair[1])) continue;
			const cost = estimateTokens(pair[1]);
			if (members.length && tokens + cost > limits.maxTokensPerBatch) {
				carry = pair;
				break;
			}
			tokens += cost;
			members.push(pair);
		}
		return members;
	}

	function createBatch(members: SectionTextPair[]) {
		let cached: TranslationResponse<string[]> | undefined;
		const [sections, setSections] = createSignal(members);
		const batch: FullPageBatch = {
			sections,
			takeCached() {
				const result = cached;
				cached = undefined;
				return result;
			},
			settled() {
				if (running.delete(batch)) schedule();
			},
			remove(section) {
				owners.delete(section);
				const remaining = sections().filter(([node]) => node !== section);
				setSections(remaining);
				if (!remaining.length) {
					misses.delete(batch);
					discard(batch);
					batch.settled();
				}
			},
		};
		for (const [section] of members) owners.set(section, batch);
		return {
			batch,
			members,
			serve(response: TranslationResponse<string[]>) {
				cached = response;
			},
		};
	}

	// Look up one round of batches together and mount the cached ones in a
	// single update. Every mount makes the browser update layout and paint for
	// the whole document, so on a long page the number of updates, not the
	// lookups, bounds how fast an already translated page appears. A cached
	// batch never becomes a tracked request: it takes no model slot, does not
	// toggle the progress indicator, and is not hidden behind a slow miss.
	function lookAhead(lookup: NonNullable<typeof probe>) {
		const round: ReturnType<typeof createBatch>[] = [];
		// A round is as wide as the model's own request concurrency, which also
		// bounds the DOM reads of one task when sections are being skipped.
		for (let i = 0; i < limits.requestConcurrency; i++) {
			const members = readBatch();
			if (members.length) round.push(createBatch(members));
			else if (!pending.size && !carry) break;
		}
		if (!round.length) return;
		probing = true;
		void Promise.all(
			round.map(async ({ members }) => {
				try {
					return await lookup(
						members.map(([, text]) => text),
						controller.signal,
					);
				} catch {
					// Let the normal translation path report lookup/transport errors.
					return null;
				}
			}),
		).then((responses) => {
			if (controller.signal.aborted) return;
			batchUpdates(() => {
				round.forEach(({ batch, members, serve }, i) => {
					const response = responses[i];
					const remaining = batch.sections();
					// Every member was removed while the lookup was in flight.
					if (!remaining.length) return;
					if (!response) {
						misses.add(batch);
						return;
					}
					if (remaining === members) serve(response);
					else {
						const indices = remaining.map((pair) => members.indexOf(pair));
						const skipped = response.skipped;
						serve({
							output: indices.map((index) => response.output[index]),
							skipped: Array.isArray(skipped)
								? indices.map((index) => skipped[index])
								: skipped,
						});
					}
					publish(batch);
				});
			});
			probing = false;
			schedule();
		});
	}

	onCleanup(() => {
		controller.abort();
		running.clear();
		misses.clear();
		cancelStep?.();
		pending.clear();
		owners.clear();
		carry = undefined;
	});

	return {
		scanWindow: limits.maxBatchSize * limits.requestConcurrency,
		add(section: DOMSection) {
			if (!pending.size) cursor = pending.values();
			pending.add(section);
			schedule();
		},
		remove(section: DOMSection) {
			pending.delete(section);
			if (carry?.[0] === section) carry = undefined;
			owners.get(section)?.remove(section);
		},
	};
}
