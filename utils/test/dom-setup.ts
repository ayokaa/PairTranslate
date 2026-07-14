import { parseHTML } from "linkedom";

const { document, DocumentFragment, Node, Element } = parseHTML(
	`<!DOCTYPE html><html><body></body></html>`,
);
const nodeFilter = {
	SHOW_ELEMENT: 1,
	FILTER_ACCEPT: 1,
	FILTER_REJECT: 2,
} as const;

(globalThis as unknown as { document: typeof document }).document = document;
(
	globalThis as unknown as { DocumentFragment: typeof DocumentFragment }
).DocumentFragment = DocumentFragment;
(globalThis as unknown as { Node: typeof Node }).Node = Node;
(globalThis as unknown as { Element: typeof Element }).Element = Element;
(globalThis as unknown as { NodeFilter: typeof nodeFilter }).NodeFilter =
	nodeFilter;
