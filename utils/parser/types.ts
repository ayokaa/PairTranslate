export interface State {
	roots: RootsIterable;
	signal?: AbortSignal;
	excludedSelector: string;
	adaptableExcludedSelector: string;
	protectedExcludedSelector: string;
	includedSelector: string;
	textTags: Set<string>;
	promoteTextTags: Set<string>;
	blockTags: Set<string>;
	listenNew: boolean;
	judgeFn?: JudgeFn;
	extraTextFilter?: RegExp;
}

export type RootsIterable = Iterable<Element> | AsyncIterable<Element>;
export type RootsInput = Element | RootsIterable;

export interface Options {
	roots?: RootsInput;
	signal?: AbortSignal;
	excludedSelectors?: string[];
	textTags?: string[];
	promoteTextTags?: string[];
	blockTags?: string[];
	listenNew?: boolean;
	extraTextFilters?: RegExp[];
	judgeFn?: JudgeFn;
	appendGenerators?: ChainedGeneratorFn[];
	filterInteractive?: boolean;
	/** Selectors that may override site-parser exclusions for visible page text. */
	includedSelectors?: string[];
	/** Explicit adaptation exclusions that included selectors cannot override. */
	protectedExcludedSelectors?: string[];
}

export type JudgeFn = (element: Element) => boolean;

export type DOMSection = readonly [start: Node, end: Node];
export type SectionGenerator = AsyncGenerator<DOMSection, void, unknown>;
export type InitialGeneratorFn = (state: State) => SectionGenerator;
export type ChainedGeneratorFn = (
	state: State,
	prev: SectionGenerator,
) => SectionGenerator;
export type DomListener = (options?: Options) => SectionGenerator;

export type WebsiteParser = {
	urlPatterns: string[];
	domListener: DomListener;
};
