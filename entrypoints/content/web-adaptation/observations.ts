import type { DOMSection } from "~/utils/parser/types";

export type TranslationObservation = {
	source: string;
	translation: string;
	element: Element;
};

const observations = new Map<Node, TranslationObservation>();
const MAX_OBSERVATIONS = 80;
export const OBSERVATION_EVENT = "pair-translate:observation";

export function recordTranslationObservation(
	section: DOMSection,
	source: string,
	translation: string,
): void {
	const start = section[0];
	const element = start.parentElement;
	if (!element || !source.trim() || !translation.trim()) return;
	observations.delete(start);
	observations.set(start, { source, translation, element });
	while (observations.size > MAX_OBSERVATIONS) {
		const oldest = observations.keys().next().value;
		if (!oldest) break;
		observations.delete(oldest);
	}
	window.dispatchEvent?.(new Event(OBSERVATION_EVENT));
}

export function getTranslationObservations(): TranslationObservation[] {
	for (const [node, observation] of observations) {
		if (!node.isConnected || !observation.element.isConnected) {
			observations.delete(node);
		}
	}
	return [...observations.values()];
}

export function clearTranslationObservations(): void {
	observations.clear();
}
