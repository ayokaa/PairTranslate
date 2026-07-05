import { parseHTML } from "linkedom";

const { document, DocumentFragment, Node, Element } = parseHTML(
	`<!DOCTYPE html><html><body></body></html>`,
);

(globalThis as unknown as { document: typeof document }).document = document;
(
	globalThis as unknown as { DocumentFragment: typeof DocumentFragment }
).DocumentFragment = DocumentFragment;
(globalThis as unknown as { Node: typeof Node }).Node = Node;
(globalThis as unknown as { Element: typeof Element }).Element = Element;
