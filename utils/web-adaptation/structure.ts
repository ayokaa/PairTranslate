import { BLOCK_TAGS, DATA_CONTAINER } from "~/utils/constants";

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
 * The identity the parser last matched on this document and pathname.
 *
 * New layout keys are recomputed to notice structural changes. When the
 * layout is unchanged, the cached legacy key keeps an old rule usable after
 * lazy-loaded paragraphs change the old, content-sensitive fingerprint.
 */
let lastStructureKey:
	| { doc: Document; key: string; pathname?: string; legacyKey?: string }
	| undefined;

export const setLastStructureKey = (
	doc: Document,
	key: string,
	pathname?: string,
	legacyKey?: string,
): void => {
	lastStructureKey = { doc, key, pathname, legacyKey };
};

export const getLastStructureIdentity = (doc: Document, pathname?: string) =>
	lastStructureKey?.doc === doc &&
	(pathname === undefined || lastStructureKey.pathname === pathname)
		? lastStructureKey
		: undefined;

export const getLastStructureKey = (doc: Document): string | undefined =>
	getLastStructureIdentity(doc)?.key;

/** Drop the cached key. Mainly for tests, where the document is shared. */
export const resetLastStructureKey = (): void => {
	lastStructureKey = undefined;
};

// Retain the existing fingerprint's storage width and sampling limits.
const MAX_STRUCTURE_PARTS = 90;
const MAX_STRUCTURE_NODES = 500;
const BLOCK_SELECTOR = BLOCK_TAGS.map((tag) => tag.toLowerCase()).join(", ");
// Standard article semantics and measured MDN/MediaWiki regions identify
// layout boundaries. Internal headings, tables, callouts and compatibility
// badges describe a reference entry, rather than a different site template.
const LAYOUT_BOUNDARY_SELECTOR = [
	"article",
	"[role='article']",
	"[itemprop='articleBody']",
	".reference-layout__header",
	".reference-layout__body",
	".mw-parser-output",
].join(", ");
const LAYOUT_CHROME_SELECTOR =
	"nav, header, footer, [role='navigation'], [role='banner'], [role='contentinfo']";
const TOC_NAME = /(?:^|[\s_-])(?:toc|table[-_]of[-_]contents)(?:$|[\s_-])/i;

function isLayoutChrome(element: Element): boolean {
	if (element.matches(LAYOUT_CHROME_SELECTOR)) return true;
	const className =
		typeof element.className === "string" ? element.className : "";
	return (
		TOC_NAME.test(`${element.id} ${className}`) &&
		element.querySelector("a, [role='link']") !== null
	);
}

function hashStructure(parts: string[]): string {
	// FNV-1a uses these fixed constants; retain the existing eight-hex key width.
	let hash = 2166136261;
	for (const char of parts.join("|")) {
		hash ^= char.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Compatibility for rules saved before layout fingerprints were introduced. */
export function getLegacyStructureKey(doc: Document): string {
	const root = doc.querySelector("main, article, [role='main']") ?? doc.body;
	if (!root) return "empty";
	const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
	const parts: string[] = [];
	let node = walker.currentNode as Element;
	let visited = 0;
	while (
		node &&
		parts.length < MAX_STRUCTURE_PARTS &&
		visited++ < MAX_STRUCTURE_NODES
	) {
		if (isSafePageElement(node)) {
			parts.push(
				`${node.tagName.toLowerCase()}.${stableClasses(node).join(".")}:${safeRole(node) ?? ""}`,
			);
		}
		node = walker.nextNode() as Element;
	}
	return hashStructure(parts);
}

/**
 * Fingerprint structural paths, not the number of paragraphs or inline marks.
 * Repeated units share one path; ancestor paths distinguish different nesting.
 * Recognized article bodies are boundaries; navigation and optional TOCs do
 * not define their layout. The existing limit bounds distinct skeleton entries.
 */
export function getStructureKey(doc: Document): string {
	const root = doc.querySelector("main, article, [role='main']") ?? doc.body;
	if (!root) return "empty";
	const parts = new Set<string>();
	const visit = (element: Element, parentPath: string) => {
		if (
			parts.size >= MAX_STRUCTURE_PARTS ||
			!isSafePageElement(element) ||
			isLayoutChrome(element)
		)
			return;
		const role = safeRole(element);
		const isBlock = BLOCK_TAGS.includes(element.tagName);
		const hasBlockChildren = element.querySelector(BLOCK_SELECTOR) !== null;
		if (element !== root && !isBlock && !role && !hasBlockChildren) return;
		// Class ordering has no structural meaning. Sort before applying the
		// existing three-class snapshot cap so class order cannot change the key.
		const classes = [...element.classList]
			.filter(isStableIdentifier)
			.sort()
			.slice(0, 3);
		const token = `${element.tagName.toLowerCase()}.${classes.join(".")}:${role ?? ""}`;
		const path = parentPath ? `${parentPath}>${token}` : token;
		parts.add(path);
		if (element.matches(LAYOUT_BOUNDARY_SELECTOR)) return;
		if (!hasBlockChildren) return;
		for (const child of element.children) visit(child, path);
	};
	visit(root, "");
	return `layout:${hashStructure([...parts].sort())}`;
}
