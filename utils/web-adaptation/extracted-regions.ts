import type { ExtractionSample } from "./verify";

const compact = (text: string) => text.replace(/\s+/g, "");

export function createExtractedRegionMatcher(
	extracted: ExtractionSample[],
): (candidate: ExtractionSample) => boolean {
	const textByElement = new Map<Element, Set<string>>();
	for (const sample of extracted) {
		const text = compact(sample.text);
		if (!text) continue;
		const texts = textByElement.get(sample.element) ?? new Set<string>();
		texts.add(text);
		textByElement.set(sample.element, texts);
	}

	return (candidate) => {
		const text = compact(candidate.text);
		if (!text) return false;

		// An extracted section can contain this candidate even when its element
		// is an ancestor of the candidate element.
		for (
			let element: Element | null = candidate.element;
			element;
			element = element.parentElement
		) {
			const directSamples = textByElement.get(element);
			if (directSamples?.has(text)) return true;
			for (const sample of directSamples ?? []) {
				if (sample.includes(text)) return true;
			}
		}

		// A site parser can split one paragraph across descendant elements. Join
		// only indexed samples in this candidate subtree before comparing text.
		const fragments: string[] = [];
		const walker = candidate.element.ownerDocument.createTreeWalker(
			candidate.element,
			NodeFilter.SHOW_ELEMENT,
		);
		for (
			let node: Node | null = candidate.element;
			node;
			node = walker.nextNode()
		) {
			fragments.push(...(textByElement.get(node as Element) ?? []));
		}
		return compact(fragments.join("")).includes(text);
	};
}
