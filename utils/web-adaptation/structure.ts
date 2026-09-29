import { DATA_CONTAINER } from "~/utils/constants";

const IGNORED = `script, style, noscript, svg, canvas, input, textarea, select, [contenteditable], [${DATA_CONTAINER}]`;

export function isSafePageElement(element: Element): boolean {
	return (
		!element.closest(IGNORED) &&
		!element.closest("[hidden], [aria-hidden='true']")
	);
}

export function stableClasses(element: Element): string[] {
	return [...element.classList].filter(isStableIdentifier).slice(0, 3);
}

function isStableIdentifier(name: string): boolean {
	return (
		/^[a-zA-Z][\w-]{1,39}$/.test(name) &&
		!/[a-f0-9]{8,}/i.test(name) &&
		!/^css-|^sc-|^_[a-z0-9]{5,}/i.test(name)
	);
}

export function stableId(element: Element): string | undefined {
	return isStableIdentifier(element.id) ? element.id : undefined;
}

export function safeRole(element: Element): string | undefined {
	const role = element.getAttribute("role") ?? "";
	return /^[a-z-]{1,30}$/.test(role) ? role : undefined;
}

/**
 * The structure key the page was last matched with at load time.
 *
 * The adaptation analysis runs later, against a DOM that may have grown since
 * (lazy-loaded content, ads, hydration). If it recomputes the key from that
 * later DOM, the rule it stores is keyed by something the parser will never
 * compute on the next load, so the rule can never match again. Both sides have
 * to use the same key, and the parser's is the one matching depends on.
 */
let lastStructureKey: { doc: Document; key: string } | undefined;

export const setLastStructureKey = (doc: Document, key: string): void => {
	lastStructureKey = { doc, key };
};

export const getLastStructureKey = (doc: Document): string | undefined =>
	lastStructureKey?.doc === doc ? lastStructureKey.key : undefined;

/** Drop the cached key. Mainly for tests, where the document is shared. */
export const resetLastStructureKey = (): void => {
	lastStructureKey = undefined;
};

export function getStructureKey(doc: Document): string {
	const root = doc.querySelector("main, article, [role='main']") ?? doc.body;
	if (!root) return "empty";
	const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
	const parts: string[] = [];
	let node = walker.currentNode as Element;
	let visited = 0;
	while (node && parts.length < 90 && visited++ < 500) {
		if (isSafePageElement(node)) {
			parts.push(
				`${node.tagName.toLowerCase()}.${stableClasses(node).join(".")}:${safeRole(node) ?? ""}`,
			);
		}
		node = walker.nextNode() as Element;
	}
	let hash = 2166136261;
	for (const char of parts.join("|")) {
		hash ^= char.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}
