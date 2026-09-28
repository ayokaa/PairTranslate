import type { DOMSection } from "~/utils/parser/types";

export type TranslationObservation = {
	source: string;
	translation: string;
	element: Element;
	elements?: Element[];
	occurrences?: number;
};

type StoredObservation = {
	source: string;
	translation: string;
	nodes: Map<Node, Element>;
};

const observations = new Map<string, StoredObservation>();
let observationKeyByNode = new WeakMap<Node, string>();
export const MAX_ADAPTATION_SOURCE_CHARACTERS = 50_000;
export const OBSERVATION_EVENT = "pair-translate:observation";

let observedNodes = 0;
let observedSourceCharacters = 0;
const sourcePairCounts = new Map<string, number>();

function normalizedSource(source: string): string {
	return source.replace(/\s+/g, " ").trim();
}

function retainSource(source: string): void {
	const key = normalizedSource(source);
	const count = sourcePairCounts.get(key);
	if (count === undefined) observedSourceCharacters += key.length;
	sourcePairCounts.set(key, (count ?? 0) + 1);
}

function releaseSource(source: string): void {
	const key = normalizedSource(source);
	const count = sourcePairCounts.get(key);
	if (count === undefined) return;
	if (count === 1) {
		sourcePairCounts.delete(key);
		observedSourceCharacters -= key.length;
	} else {
		sourcePairCounts.set(key, count - 1);
	}
}

function observationKey(source: string, translation: string): string {
	return JSON.stringify([
		source.replace(/\s+/g, " ").trim(),
		translation.replace(/\s+/g, " ").trim(),
	]);
}

function removeObservation(key: string): void {
	const observation = observations.get(key);
	if (!observation) return;
	observations.delete(key);
	for (const node of observation.nodes.keys())
		observationKeyByNode.delete(node);
	observedNodes -= observation.nodes.size;
	releaseSource(observation.source);
}

function removeNode(node: Node): void {
	const key = observationKeyByNode.get(node);
	if (!key) return;
	observationKeyByNode.delete(node);
	const observation = observations.get(key);
	if (!observation) return;
	observation.nodes.delete(node);
	observedNodes--;
	if (observation.nodes.size === 0) removeObservation(key);
}

function removeOldestObservation(): void {
	const oldest = observations.keys().next().value;
	if (oldest) removeObservation(oldest);
}

export function recordTranslationObservation(
	section: DOMSection,
	source: string,
	translation: string,
): void {
	const start = section[0];
	const element = start.parentElement;
	if (
		!element ||
		!source.trim() ||
		!translation.trim() ||
		source.length > MAX_ADAPTATION_SOURCE_CHARACTERS
	)
		return;
	const key = observationKey(source, translation);
	const previousKey = observationKeyByNode.get(start);
	const previous = previousKey ? observations.get(previousKey) : undefined;
	if (previousKey === key && previous?.nodes.get(start) === element) return;
	if (previousKey) removeNode(start);

	let observation = observations.get(key);
	if (observation) {
		observations.delete(key);
	} else {
		observation = {
			source,
			translation,
			nodes: new Map(),
		};
		retainSource(observation.source);
	}
	observation.nodes.set(start, element);
	observations.set(key, observation);
	observationKeyByNode.set(start, key);
	observedNodes++;
	while (
		// A non-empty source is required for every observation, so the character
		// target also provides a derived upper bound for highly fragmented pages.
		observedNodes > MAX_ADAPTATION_SOURCE_CHARACTERS ||
		observedSourceCharacters > MAX_ADAPTATION_SOURCE_CHARACTERS
	) {
		removeOldestObservation();
	}
	window.dispatchEvent?.(new Event(OBSERVATION_EVENT));
}

export function getTranslationObservations(): TranslationObservation[] {
	const result: TranslationObservation[] = [];
	for (const [key, observation] of [...observations]) {
		for (const [node, element] of observation.nodes) {
			if (!node.isConnected || !element.isConnected) removeNode(node);
		}
		const current = observations.get(key);
		if (!current || current.nodes.size === 0) continue;
		const elements = [...new Set(current.nodes.values())];
		result.push({
			source: current.source,
			translation: current.translation,
			element: elements[0] as Element,
			elements,
			occurrences: current.nodes.size,
		});
	}
	return result;
}

export function clearTranslationObservations(): void {
	observations.clear();
	observationKeyByNode = new WeakMap();
	observedNodes = 0;
	observedSourceCharacters = 0;
	sourcePairCounts.clear();
}
