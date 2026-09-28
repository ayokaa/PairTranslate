import {
	getStructureKey,
	isSafePageElement,
	safeRole,
	stableClasses,
	stableId,
} from "~/utils/web-adaptation/structure";
import {
	getTranslationObservations,
	MAX_ADAPTATION_SOURCE_CHARACTERS,
	type TranslationObservation,
} from "./observations";

const MAX_OUTLINE_NODES = 600;
/** Total budget for direct text echoed into the outline. */
const MAX_OUTLINE_CHARACTERS = 20_000;

export type UntranslatedSample = { text: string; element: Element };

function scrubText(value: string, limit?: number): string {
	const scrubbed = value
		.replace(/https?:\/\/\S+/gi, "[link]")
		.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
		.replace(/\b(?:\d[ -]?){12,19}\b/g, "[number]")
		.replace(/\s+/g, " ")
		.trim();
	return limit === undefined ? scrubbed : scrubbed.slice(0, limit);
}

function directText(element: Element): string {
	let text = "";
	for (const node of element.childNodes) {
		if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? "";
	}
	return scrubText(text, 100);
}

function elementPath(element: Element): string {
	const parts: string[] = [];
	let current: Element | null = element;
	while (current && parts.length < 4 && current !== document.body) {
		const id = stableId(current);
		const classes = stableClasses(current)
			.slice(0, 2)
			.map((name) => `.${name}`)
			.join("");
		parts.unshift(
			`${current.tagName.toLowerCase()}${id ? `#${id}` : ""}${classes}`,
		);
		if (id) break;
		current = current.parentElement;
	}
	return parts.join(" > ");
}

function safePairs(observations: TranslationObservation[]) {
	let sourceCharacters = 0;
	const includedSources = new Set<string>();
	const uniquePairs = new Map<
		string,
		{
			paths: Set<string>;
			source: string;
			translation: string;
			occurrences: number;
		}
	>();
	for (const item of observations) {
		const elements = (item.elements ?? [item.element]).filter(
			isSafePageElement,
		);
		if (elements.length === 0) continue;
		const source = scrubText(item.source);
		const translation = scrubText(item.translation);
		const key = JSON.stringify([source, translation]);
		const existing = uniquePairs.get(key);
		if (existing) {
			for (const element of elements) existing.paths.add(elementPath(element));
			existing.occurrences += item.occurrences ?? 1;
			continue;
		}
		uniquePairs.set(key, {
			paths: new Set(elements.map(elementPath)),
			source,
			translation,
			occurrences: item.occurrences ?? 1,
		});
	}
	const pairs: Array<{
		paths: string[];
		source: string;
		translation: string;
		occurrences: number;
	}> = [];
	for (const item of uniquePairs.values()) {
		const isNewSource = !includedSources.has(item.source);
		if (
			isNewSource &&
			sourceCharacters + item.source.length > MAX_ADAPTATION_SOURCE_CHARACTERS
		)
			continue;
		pairs.push({
			paths: [...item.paths],
			source: item.source,
			translation: item.translation,
			occurrences: item.occurrences,
		});
		if (isNewSource) {
			includedSources.add(item.source);
			sourceCharacters += item.source.length;
		}
	}
	return { pairs, includedSources, sourceCharacters };
}

function safeUntranslated(
	samples: UntranslatedSample[],
	includedSources: Set<string>,
	initialSourceCharacters: number,
) {
	let sourceCharacters = initialSourceCharacters;
	const uniqueSamples = new Map<
		string,
		{ paths: Set<string>; text: string; occurrences: number }
	>();
	for (const sample of samples) {
		if (!isSafePageElement(sample.element)) continue;
		const text = scrubText(sample.text);
		if (!text) continue;
		const existing = uniqueSamples.get(text);
		if (existing) {
			existing.paths.add(elementPath(sample.element));
			existing.occurrences++;
			continue;
		}
		uniqueSamples.set(text, {
			paths: new Set([elementPath(sample.element)]),
			text,
			occurrences: 1,
		});
	}
	const untranslated: Array<{
		paths: string[];
		text: string;
		occurrences: number;
	}> = [];
	for (const sample of uniqueSamples.values()) {
		if (
			!includedSources.has(sample.text) &&
			sourceCharacters + sample.text.length > MAX_ADAPTATION_SOURCE_CHARACTERS
		)
			continue;
		untranslated.push({
			paths: [...sample.paths],
			text: sample.text,
			occurrences: sample.occurrences,
		});
		if (!includedSources.has(sample.text)) {
			includedSources.add(sample.text);
			sourceCharacters += sample.text.length;
		}
	}
	return untranslated;
}

export function matchUntranslatedEvidence(
	samples: UntranslatedSample[],
	accepted: Array<{ paths: string[]; text: string }>,
): UntranslatedSample[] {
	const acceptedEvidence = new Set<string>();
	for (const item of accepted) {
		for (const path of item.paths)
			acceptedEvidence.add(JSON.stringify([item.text, path]));
	}
	return samples.filter((sample) => {
		const text = scrubText(sample.text);
		const path = elementPath(sample.element);
		return acceptedEvidence.has(JSON.stringify([text, path]));
	});
}

export function buildPageSnapshot(
	extraPairs: TranslationObservation[] = [],
	untranslatedSamples: UntranslatedSample[] = [],
) {
	const root = document.body;
	if (!root) throw new Error("Page body is unavailable");
	const outline: Array<{
		depth: number;
		tag: string;
		id?: string;
		classes?: string[];
		role?: string;
		text?: string;
	}> = [];
	const seen = new Set<Element>();
	let outlineCharacters = 0;
	const addOutline = (start: Element, max: number) => {
		const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT);
		let node: Node | null = start;
		let visited = 0;
		while (
			node &&
			outline.length < max &&
			outlineCharacters < MAX_OUTLINE_CHARACTERS &&
			visited++ < MAX_OUTLINE_NODES
		) {
			const element = node as Element;
			if (!seen.has(element) && isSafePageElement(element)) {
				seen.add(element);
				let depth = 0;
				let parent = element.parentElement;
				while (parent && parent !== root) {
					depth++;
					parent = parent.parentElement;
				}
				const id = stableId(element);
				const classes = stableClasses(element);
				const role = safeRole(element);
				const text = directText(element);
				outlineCharacters += text.length;
				outline.push({
					depth: Math.min(depth, 12),
					tag: element.tagName.toLowerCase(),
					...(id && { id }),
					...(classes.length && { classes }),
					...(role && { role }),
					...(text && { text }),
				});
			}
			node = walker.nextNode();
		}
	};
	const primary = root.querySelector("main, article, [role='main']");
	addOutline(root, primary ? 40 : MAX_OUTLINE_NODES);
	if (primary) addOutline(primary, MAX_OUTLINE_NODES);
	const pathname = window.location.pathname;
	const safePairData = safePairs([
		...getTranslationObservations(),
		...extraPairs,
	]);
	return {
		hostname: window.location.hostname,
		pathname,
		structureKey: getStructureKey(document),
		outline,
		pairs: safePairData.pairs,
		untranslated: safeUntranslated(
			untranslatedSamples,
			safePairData.includedSources,
			safePairData.sourceCharacters,
		),
	};
}
