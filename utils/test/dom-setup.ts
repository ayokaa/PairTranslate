import { parseHTML } from "linkedom";

const { document, DocumentFragment, Node, Element } = parseHTML(
	`<!DOCTYPE html><html><body></body></html>`,
);
const nodeFilter = {
	SHOW_ELEMENT: 1,
	SHOW_TEXT: 4,
	FILTER_ACCEPT: 1,
	FILTER_REJECT: 2,
	FILTER_SKIP: 3,
} as const;

(globalThis as unknown as { document: typeof document }).document = document;
(
	globalThis as unknown as { DocumentFragment: typeof DocumentFragment }
).DocumentFragment = DocumentFragment;
(globalThis as unknown as { Node: typeof Node }).Node = Node;
(globalThis as unknown as { Element: typeof Element }).Element = Element;
(globalThis as unknown as { NodeFilter: typeof nodeFilter }).NodeFilter =
	nodeFilter;

// linkedom's TreeWalker ignores the acceptNode filter entirely. Replace it
// with a pre-order DFS that honors it (REJECT prunes the subtree, SKIP
// descends without including), so selector-based exclusions are exercised in
// tests like they are in browsers. nextSibling/parentNode are deliberately
// omitted: the parser falls back to a nextNode()-based subtree skip.
(document as unknown as { createTreeWalker: unknown }).createTreeWalker = (
	root: Node,
	whatFilter: number,
	filter?: { acceptNode?: (node: Node) => number } | ((node: Node) => number),
) => {
	const acceptNode = typeof filter === "function" ? filter : filter?.acceptNode;
	const accepted: Node[] = [];
	// Browsers apply whatFilter as a bitmask; non-matching nodes are still
	// descended into (like FILTER_SKIP), never handed to acceptNode.
	const matchesShow = (node: Node): boolean => {
		if (node.nodeType === 1)
			return (whatFilter & nodeFilter.SHOW_ELEMENT) !== 0;
		if (node.nodeType === 3) return (whatFilter & nodeFilter.SHOW_TEXT) !== 0;
		return false;
	};
	const visit = (node: Node) => {
		for (const child of Array.from(node.childNodes ?? [])) {
			if (!matchesShow(child)) {
				visit(child);
				continue;
			}
			const verdict = acceptNode ? acceptNode(child) : 1;
			if (verdict === nodeFilter.FILTER_REJECT) continue;
			if (verdict === nodeFilter.FILTER_SKIP) {
				visit(child);
				continue;
			}
			accepted.push(child);
			visit(child);
		}
	};
	visit(root);
	let index = -1;
	return {
		get currentNode() {
			return accepted[index] ?? root;
		},
		nextNode() {
			index++;
			return accepted[index] ?? null;
		},
	};
};
