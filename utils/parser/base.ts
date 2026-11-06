import { hasMeaningfulChars } from "~/utils/blank";
import {
	BLOCK_TAGS,
	DATA_CONTAINER,
	DATA_TRANSLATED,
	EXCLUDED_SELECTORS,
	INTERACTIVE_SELECTORS,
	TEXT_TAGS,
} from "~/utils/constants";
import { createNotifier } from "~/utils/notify";
import { EDITABLE_SELECTOR, isVisiblePageContent } from "~/utils/page-content";
import type {
	ChainedGeneratorFn,
	DOMSection,
	InitialGeneratorFn,
	Options,
	RootsInput,
	RootsIterable,
	SectionGenerator,
	State,
} from "./types";

// Combine for better performance
const COMMON_SKIP_PATTERNS = new RegExp(
	[
		// URLs and domains
		/^(?:(?:https?|ftp):\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?::\d{1,5})?(?:\/[^\s]*)?$/
			.source,
		// Repeated characters (like "...")
		/^(.)\1{2,}$/.source,
	].join("|"),
	"i",
);

const NOT_EMPTY_REGEX = /\S/;

// Block-level text containers promote to a whole paragraph by default when
// all their text is wrapped in inline elements (highlights, links, code):
// without promotion each styled inline child would become its own fragment
// section, and translators merge such fragments back, breaking the count
// alignment of batch responses. Elements with block-level descendants are
// still traversed (see hasBlockDescendant).
const DEFAULT_PROMOTE_TEXT_TAGS = TEXT_TAGS.filter((tag) =>
	(BLOCK_TAGS as string[]).includes(tag),
);

// Check if a node is a visible text node
const showTextNode = (node: Node): boolean =>
	node.nodeType === Node.TEXT_NODE &&
	NOT_EMPTY_REGEX.test(node.nodeValue || "");

// Check if element has its own text nodes (not inside children)
const hasDirectText = (el: Element): boolean => {
	let node = el.firstChild;
	while (node) {
		if (showTextNode(node)) {
			return true;
		}

		node = node.nextSibling;
	}
	return false;
};

// Inline wrappers such as word-highlighting spans should be translated with
// their surrounding paragraph. Block descendants still define boundaries.
const hasBlockDescendant = (el: Element, blockTags: Set<string>): boolean => {
	let node = el.firstChild;
	while (node) {
		if (node.nodeType === Node.ELEMENT_NODE) {
			const child = node as Element;
			if (
				blockTags.has(child.tagName) ||
				hasBlockDescendant(child, blockTags)
			) {
				return true;
			}
		}
		node = node.nextSibling;
	}
	return false;
};

// The extension's own injected translation UI. It carries these attributes and
// is itself covered by the excluded selector, but it must not count when
// deciding promotion — otherwise re-scanning an already-translated page would
// suddenly refuse to promote and shatter the paragraph into fragments.
const OWN_UI_SELECTOR = `[${DATA_CONTAINER}], [${DATA_TRANSLATED}]`;

// Promotion short-circuits the tree walk: a promoted container's children are
// taken as section content directly, so descendants the walker would have
// rejected (site chrome like HN's .comhead) would leak into the section.
// Refuse promotion for containers holding excluded descendants.
const hasExcludedDescendant = (
	el: Element,
	excludedSelector: string,
): boolean => {
	for (const descendant of el.querySelectorAll(excludedSelector)) {
		if (!descendant.closest(OWN_UI_SELECTOR)) return true;
	}
	return false;
};

const skipSubtree = (walker: TreeWalker): Element | null => {
	// Browsers provide sibling traversal that can skip a subtree without
	// walking every descendant.
	if (typeof walker.nextSibling === "function") {
		const sibling = walker.nextSibling();
		if (sibling) return sibling as Element;

		let parent = walker.parentNode();
		while (parent) {
			const uncle = walker.nextSibling();
			if (uncle) return uncle as Element;
			parent = walker.parentNode();
		}

		return null;
	}

	// Some lightweight DOM implementations omit nextSibling(). Continue with
	// nextNode() until the walker leaves the current element.
	const current = walker.currentNode;
	let next = walker.nextNode();
	while (next && current.contains(next)) {
		next = walker.nextNode();
	}
	return (next as Element | null) ?? null;
};

const getTextFromSection = (section: DOMSection): string => {
	if (section instanceof Node) {
		return section.textContent || "";
	} else {
		let start: Node | null = section[0];
		const end = section[1];
		const texts: string[] = [];

		while (start) {
			if (start === end) {
				texts.push(start.textContent || "");
				break;
			} else {
				texts.push(start.textContent || "");
				start = start.nextSibling;
			}
		}

		return texts.join("");
	}
};

export async function* elementWalker(state: State): SectionGenerator {
	const isSafeIncludedTarget = (element: Element) =>
		!state.protectedExcludedSelector ||
		!hasExcludedDescendant(element, state.protectedExcludedSelector);

	const hasIncludedWithin = (el: Element) => {
		if (!state.includedSelector) return false;
		if (el.matches(state.includedSelector) && isSafeIncludedTarget(el))
			return true;
		return [...el.querySelectorAll(state.includedSelector)].some(
			isSafeIncludedTarget,
		);
	};

	const getUnresolvedAdaptableExclusion = (el: Element): Element | null => {
		if (!state.adaptableExcludedSelector) return null;
		let included = state.includedSelector
			? el.closest(state.includedSelector)
			: null;
		if (included && !isSafeIncludedTarget(included)) included = null;
		for (
			let current: Element | null = el;
			current;
			current = current.parentElement
		) {
			if (
				current.matches(state.adaptableExcludedSelector) &&
				(!included || !current.contains(included))
			)
				return current;
		}
		return null;
	};

	const isProtectedPath = (el: Element) =>
		Boolean(
			state.protectedExcludedSelector &&
				el.closest(state.protectedExcludedSelector),
		);

	const isExcludedPath = (el: Element) => {
		if (isProtectedPath(el)) return true;
		if (state.judgeFn && !state.judgeFn(el)) return true;
		return Boolean(
			getUnresolvedAdaptableExclusion(el) && !hasIncludedWithin(el),
		);
	};

	const judgeText = (el: Element): boolean => {
		// Callers either pass a root through isExcludedPath or receive an
		// element accepted by the tree walker. Keep ancestor checks out of this
		// per-element hot path.
		if (!state.textTags.has(el.tagName) || !isVisiblePageContent(el))
			return false;
		if (hasDirectText(el)) return true;

		// Math may live in a leaf container with no direct text (e.g. p >
		// span.math). Promote those leaves so formulas are still captured.
		// Do NOT promote layout ancestors that merely contain math somewhere
		// deeper: that would skipSubtree the whole article (Quarto, etc.).
		const mathSelector =
			"mjx-container, math, .katex, .math.inline, .math.display";
		if (
			el.querySelector(mathSelector) &&
			!hasBlockDescendant(el, state.blockTags)
		) {
			return true;
		}
		if (!state.promoteTextTags.has(el.tagName)) return false;
		if (hasBlockDescendant(el, state.blockTags)) return false;
		if (hasExcludedDescendant(el, state.excludedSelector)) return false;
		if (NOT_EMPTY_REGEX.test(el.textContent || "")) return true;

		return false;
	};

	const createElementWalker = (element: Node) => {
		return document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT, {
			acceptNode: (node) => {
				const el = node as Element;

				if (
					(state.protectedExcludedSelector &&
						el.matches(state.protectedExcludedSelector)) ||
					(state.judgeFn && !state.judgeFn(el))
				) {
					return NodeFilter.FILTER_REJECT;
				}
				if (getUnresolvedAdaptableExclusion(el)) {
					return hasIncludedWithin(el)
						? NodeFilter.FILTER_SKIP
						: NodeFilter.FILTER_REJECT;
				}

				return NodeFilter.FILTER_ACCEPT;
			},
		});
	};

	const notifier = createNotifier();
	const rootsList: WeakRef<Node>[] = [];
	const observedRoots: WeakRef<Node>[] = [];
	const observedNodes = new WeakSet<Node>();

	const queuePresentationScan = (element: Element) => {
		if (isExcludedPath(element)) return;
		// Attribute and animation changes must reproduce the initial paragraph
		// boundary, not emit a second section for an inline descendant.
		let root = element;
		while (
			root.parentElement &&
			!state.blockTags.has(root.tagName) &&
			!observedNodes.has(root)
		) {
			root = root.parentElement;
		}
		rootsList.push(new WeakRef(root));
	};
	const onPresentationChange = (event: Event) => {
		if (event.target instanceof Element) queuePresentationScan(event.target);
		if (rootsList.length > 0) notifier.notify();
	};

	const mutationHandler: MutationCallback = (mutations) => {
		for (const mutation of mutations) {
			if (mutation.type === "attributes") {
				const target = mutation.target as Element;
				queuePresentationScan(target);
				continue;
			}
			for (const node of mutation.addedNodes) {
				if (node.nodeType === Node.ELEMENT_NODE) {
					const root = node as Element;
					if (isExcludedPath(root)) continue;

					rootsList.push(new WeakRef(root));
				}
			}
		}
		if (rootsList.length > 0) notifier.notify();
	};

	const observer = state.listenNew
		? new MutationObserver(mutationHandler)
		: null;

	const observeElement = (el: Node) => {
		if (!state.listenNew || observedNodes.has(el)) return;
		observedNodes.add(el);
		observedRoots.push(new WeakRef(el));
		el.addEventListener("animationend", onPresentationChange);
		el.addEventListener("transitionend", onPresentationChange);
		observer?.observe(el, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["class", "style", "hidden", "aria-hidden", "open"],
			characterData: false,
		});
	};

	const onResize = () => {
		for (const ref of observedRoots) rootsList.push(ref);
		notifier.notify();
	};
	const cleanup = () => {
		observer?.disconnect();
		for (const ref of observedRoots) {
			ref.deref()?.removeEventListener("animationend", onPresentationChange);
			ref.deref()?.removeEventListener("transitionend", onPresentationChange);
		}
		if (state.listenNew) window.removeEventListener("resize", onResize);
	};

	// Iframes run their own content script. Only shadow roots need traversal
	// from their containing document.
	const findTextElementsInSpecialContainer = function* (
		element: Node,
	): Generator<Element> {
		if (element.nodeType !== Node.ELEMENT_NODE) return;
		const el = element as Element;
		const root = el.shadowRoot;

		if (root) {
			yield* findTextElements(root);
			observeElement(root);
		}
	};

	// Find element with direct text
	const findTextElements = function* (root: Node): Generator<Element> {
		const walker = createElementWalker(root);
		let node = walker.nextNode();

		while (node) {
			const element = node as Element;
			if (judgeText(element)) {
				node = skipSubtree(walker);
				yield element;
			} else {
				node = walker.nextNode();
				yield* findTextElementsInSpecialContainer(element);
			}
		}
	};

	// If element has block-level children, split into multiple paragraphs
	const paragraphSplitter = function* (
		element: Element,
	): Generator<DOMSection> {
		let node = element.firstChild;
		let start: Node | null = null;
		let end: Node | null = null;

		const flush = function* () {
			if (start && end) {
				yield [start, end] as const;
				start = null;
				end = null;
			}
		};

		while (node) {
			if (node.nodeType === Node.ELEMENT_NODE) {
				const el = node as Element;
				if (state.blockTags.has(el.tagName)) {
					// Flush current inline segment
					yield* flush();

					// Yield block element
					yield* findTextElementsAndSplit(el);
				} else if (!isVisiblePageContent(el)) {
					yield* flush();
					// visibility can be overridden by a descendant.
					yield* findTextElementsAndSplit(el);
				} else {
					// An inline element
					if (!start) start = node;
					end = node;
				}
			} else if (showTextNode(node)) {
				if (!start) start = node;
				end = node;
			}

			node = node.nextSibling;
		}

		yield* flush();
	};

	// Find text elements within root, and split into paragraphs
	const findTextElementsAndSplit = function* (
		root: Element,
		pathIsChecked = false,
	): Generator<DOMSection> {
		if (!pathIsChecked && isExcludedPath(root)) return;
		if (judgeText(root)) {
			yield* paragraphSplitter(root);
			return;
		}

		const generator = findTextElements(root);
		for (const element of generator) {
			yield* paragraphSplitter(element);
		}
	};

	const onAbort = () => notifier.notify();
	try {
		for await (const root of state.roots) {
			observeElement(root);
			if (isExcludedPath(root)) continue;
			yield* findTextElementsAndSplit(root, true);
		}
		if (!state.listenNew || state.signal?.aborted) return;
		window.addEventListener("resize", onResize);
		state.signal?.addEventListener("abort", onAbort);

		while (!state.signal?.aborted) {
			if (rootsList.length === 0) await notifier.wait();
			if (state.signal?.aborted) break;
			const pendingRoots = rootsList.splice(0);
			const elements = new Set(pendingRoots.map((ref) => ref.deref()));
			for (const element of elements) {
				if (!element?.isConnected) continue;
				if (element instanceof Element)
					yield* findTextElementsAndSplit(element);
				else {
					for (const child of findTextElements(element))
						yield* paragraphSplitter(child);
				}
			}
		}
	} finally {
		state.signal?.removeEventListener("abort", onAbort);
		cleanup();
	}
}

// Track visible text coverage, not only a range's first node: a presentation
// change can reveal new inline text while retaining the same paragraph start.
export async function* emittedFilter(
	_state: State,
	prev: SectionGenerator,
): SectionGenerator {
	const covered = new WeakSet<Node>();
	const emptyStarts = new WeakSet<Node>();
	const visibleTexts = (node: Node): Node[] => {
		if (node.nodeType === Node.TEXT_NODE) {
			return showTextNode(node) &&
				(!node.parentElement || isVisiblePageContent(node.parentElement))
				? [node]
				: [];
		}
		if (node instanceof Element && node.matches(`[${DATA_CONTAINER}]`))
			return [];
		return [...node.childNodes].flatMap(visibleTexts);
	};
	const uncovered = function* (node: Node): Generator<Node> {
		const texts = visibleTexts(node);
		if (texts.length === 0) return;
		if (texts.every((text) => !covered.has(text))) {
			yield node;
		} else {
			for (const child of node.childNodes) yield* uncovered(child);
		}
	};
	for await (const section of prev) {
		const nodes: Node[] = [];
		for (let node: Node | null = section[0]; node; node = node.nextSibling) {
			nodes.push(node);
			if (node === section[1]) break;
		}
		const texts = nodes.flatMap(visibleTexts);
		if (texts.length === 0) {
			// Preserve non-text sections such as source-backed math containers.
			if (!emptyStarts.has(section[0])) {
				emptyStarts.add(section[0]);
				yield section;
			}
			continue;
		}
		if (texts.every((text) => !covered.has(text))) {
			for (const text of texts) covered.add(text);
			yield section;
			continue;
		}
		const additions = nodes.flatMap((node) => [...uncovered(node)]);
		let start: Node | undefined;
		let end: Node | undefined;
		for (const node of additions) {
			for (const text of visibleTexts(node)) covered.add(text);
			if (start && end && end.nextSibling !== node) {
				yield [start, end];
				start = undefined;
			}
			start ??= node;
			end = node;
		}
		if (start && end) yield [start, end];
	}
}

export async function* textContentFilter(
	state: State,
	prev: SectionGenerator,
): SectionGenerator {
	for await (const section of prev) {
		const text = getTextFromSection(section).trim();

		if (!hasMeaningfulChars(text)) {
			continue;
		}
		if (COMMON_SKIP_PATTERNS.test(text)) {
			continue;
		}
		if (state.extraTextFilter?.test(text)) {
			continue;
		}

		yield section;
	}
}

export function pipe(
	state: State,
	fn: InitialGeneratorFn,
	...fns: ChainedGeneratorFn[]
): SectionGenerator {
	let stream = fn(state);
	for (const f of fns) {
		stream = f(state, stream);
	}
	return stream;
}

const normalizeRoots = (roots?: RootsInput): RootsIterable => {
	const defaultRoot = document.body || document.documentElement;
	if (!roots) return defaultRoot ? [defaultRoot] : [];
	if (roots instanceof Element) return [roots];
	if (Symbol.asyncIterator in roots) return roots;
	return roots;
};

export function getState(options: Options = {}): State {
	const adaptableExcludedSelector = (options.excludedSelectors || []).join(
		", ",
	);
	const excludedSelectors = options.includeTranslated
		? EXCLUDED_SELECTORS.filter(
				(selector) => selector !== `[${DATA_TRANSLATED}]`,
			)
		: EXCLUDED_SELECTORS;
	const protectedExcludedSelector = [
		...(options.protectedExcludedSelectors || []),
		...excludedSelectors,
		EDITABLE_SELECTOR,
		"[hidden]",
		...((options.filterInteractive ?? true) ? INTERACTIVE_SELECTORS : []),
	].join(", ");
	return {
		roots: normalizeRoots(options.roots),
		signal: options.signal,
		excludedSelector: [adaptableExcludedSelector, protectedExcludedSelector]
			.filter(Boolean)
			.join(", "),
		adaptableExcludedSelector,
		protectedExcludedSelector,
		includedSelector: (options.includedSelectors || []).join(", "),
		textTags: new Set(
			[...(options.textTags || []), ...TEXT_TAGS].map((s) => s.toUpperCase()),
		),
		promoteTextTags: new Set(
			[...DEFAULT_PROMOTE_TEXT_TAGS, ...(options.promoteTextTags || [])].map(
				(s) => s.toUpperCase(),
			),
		),
		blockTags: new Set(
			[...(options.blockTags || []), ...BLOCK_TAGS].map((s) => s.toUpperCase()),
		),
		judgeFn: options.judgeFn,
		listenNew: options.listenNew ?? true,
		extraTextFilter: options.extraTextFilters
			? new RegExp(options.extraTextFilters.map((r) => r.source).join("|"), "i")
			: undefined,
	};
}

export function domListener(options: Options = {}): SectionGenerator {
	const state = getState(options);

	const defaultGenerators: ChainedGeneratorFn[] = [
		emittedFilter, // Keeps distinct object references unique
		textContentFilter, // Filters noise (dates, emails, etc)
	];
	const appendGenerators = options.appendGenerators || [];

	// childFilter is removed from pipeline
	return pipe(state, elementWalker, ...defaultGenerators, ...appendGenerators);
}
