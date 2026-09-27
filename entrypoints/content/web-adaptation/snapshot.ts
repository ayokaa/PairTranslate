import {
	getStructureKey,
	isSafePageElement,
	safeRole,
	stableClasses,
	stableId,
} from "~/utils/web-adaptation/structure";
import {
	getTranslationObservations,
	type TranslationObservation,
} from "./observations";

const MAX_OUTLINE_NODES = 160;
const MAX_PAIRS = 24;

function scrubText(value: string, limit: number): string {
	return value
		.replace(/https?:\/\/\S+/gi, "[link]")
		.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
		.replace(/\b(?:\d[ -]?){12,19}\b/g, "[number]")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, limit);
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
	return observations
		.filter((item) => isSafePageElement(item.element))
		.slice(-MAX_PAIRS)
		.map((item) => ({
			path: elementPath(item.element),
			source: scrubText(item.source, 320),
			translation: scrubText(item.translation, 320),
		}));
}

export function buildPageSnapshot(extraPairs: TranslationObservation[] = []) {
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
	const addOutline = (start: Element, max: number) => {
		const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT);
		let node: Node | null = start;
		let visited = 0;
		while (node && outline.length < max && visited++ < 600) {
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
	return {
		hostname: window.location.hostname,
		pathname,
		structureKey: getStructureKey(document),
		outline,
		pairs: safePairs([...getTranslationObservations(), ...extraPairs]),
	};
}
