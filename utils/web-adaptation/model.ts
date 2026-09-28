import { z } from "zod";
import {
	DATA_TRANSLATED,
	EXCLUDED_SELECTORS,
	TEXT_TAGS,
} from "~/utils/constants";

const Selector = z.string().trim().min(1).max(180);
const Tag = z.string().regex(/^[a-zA-Z][a-zA-Z0-9-]{0,15}$/);
const REINCLUSION_PROTECTED_DESCENDANTS = [
	"script",
	"style",
	"noscript",
	"pre",
	"code",
	".code",
	".highlight",
	".monaco-editor",
	"[translate=false]",
	"[translate=no]",
	".notranslate",
	"[data-nosnippet]",
	"[contenteditable]",
	"[hidden]",
	"[aria-hidden='true']",
].join(", ");
const REINCLUSION_TARGET_PROTECTED_SELECTOR = [
	...EXCLUDED_SELECTORS.filter(
		(selector) => selector !== `[${DATA_TRANSLATED}]`,
	),
	"[contenteditable]",
	"[hidden]",
	"[aria-hidden='true']",
].join(", ");
const SAFE_SELECTOR_PATTERN = /^[-a-zA-Z0-9_#. >[\]="'^$]+$/;

export const AdaptationPatch = z.strictObject({
	roots: z.array(Selector).default([]),
	excludes: z.array(Selector).max(12).default([]),
	// Match the existing per-rule exclusion-selector budget.
	includes: z.array(Selector).max(12).default([]),
	promoteTags: z.array(Tag).max(8).default([]),
});
export type AdaptationPatch = z.infer<typeof AdaptationPatch>;

export const AdaptationSuggestion = AdaptationPatch.extend({
	reason: z.string().max(500).optional(),
});

const EMPTY_PATCH: AdaptationPatch = {
	roots: [],
	excludes: [],
	includes: [],
	promoteTags: [],
};

/** Field caps mirroring AdaptationPatch, so an appended rule still validates. */
const MAX_EXCLUDES = 12;
const MAX_INCLUDES = 12;
const MAX_PROMOTE_TAGS = 8;

/**
 * Append a proposal to the patch currently in force.
 *
 * Rules only ever grow: the model is told to suggest a small declarative
 * change, so an analysis that mentions one field must not drop the roots or
 * exclusions saved earlier. Each field is a deduplicated union inside the
 * patch schema, and when a field is full the saved selectors win over the new
 * proposal. A proposal that adds nothing yields the existing patch unchanged,
 * which callers detect as "no change".
 */
export function appendAdaptationPatch(
	existing: AdaptationPatch | undefined,
	incoming: AdaptationPatch,
): AdaptationPatch {
	const base = existing ? normalizePatch(existing) : EMPTY_PATCH;
	const addition = normalizePatch(incoming);
	const cappedUnion = (saved: string[], proposed: string[], cap: number) => {
		// Saved selectors always survive the cap: appending must never drop what
		// earlier analyses stored, so only the new proposal can be left out.
		const kept = [...new Set(saved)];
		const fresh = [...new Set(proposed)].filter(
			(value) => !kept.includes(value),
		);
		return [...kept, ...fresh].slice(0, cap).sort();
	};
	return {
		roots: cappedUnion(base.roots, addition.roots, Number.POSITIVE_INFINITY),
		excludes: cappedUnion(base.excludes, addition.excludes, MAX_EXCLUDES),
		includes: cappedUnion(base.includes, addition.includes, MAX_INCLUDES),
		promoteTags: cappedUnion(
			base.promoteTags,
			addition.promoteTags,
			MAX_PROMOTE_TAGS,
		),
	};
}

export const AdaptationRule = z.strictObject({
	id: z.uuid(),
	hostname: z.string().min(1).max(253),
	pathPatterns: z.array(z.string().min(1).max(500)).min(1).max(30),
	structureKey: z.string().min(1).max(32),
	enabled: z.boolean(),
	source: z.enum(["manual", "automatic"]),
	patch: AdaptationPatch,
	createdAt: z.number().int().nonnegative(),
	updatedAt: z.number().int().nonnegative(),
});
export type AdaptationRule = z.infer<typeof AdaptationRule>;

export const WebAdaptationSettings = z.object({
	autoEnabled: z.boolean().default(false),
	modelId: z.uuid().optional(),
	rules: z.array(AdaptationRule).default([]),
});
export type WebAdaptationSettings = z.infer<typeof WebAdaptationSettings>;

/** Rules are keyed by structure fingerprint, so structure drift can pile up. */
export const MAX_RULES_PER_HOST = 20;

/**
 * Keep the rule list bounded per host, dropping the least recently updated
 * entries first. A rule touched by the current upsert is always kept.
 */
export function enforceRuleBudget(rules: AdaptationRule[]): AdaptationRule[] {
	if (rules.length <= MAX_RULES_PER_HOST) return rules;
	const perHost = new Map<string, number>();
	const keptIds = new Set<string>();
	// Newest first, so the rule an upsert just touched always survives; iterating
	// the reversed array keeps the relative order stable for equal timestamps.
	for (const rule of [...rules]
		.reverse()
		.sort((a, b) => b.updatedAt - a.updatedAt)) {
		const count = perHost.get(rule.hostname) ?? 0;
		if (count >= MAX_RULES_PER_HOST) continue;
		perHost.set(rule.hostname, count + 1);
		keptIds.add(rule.id);
	}
	// Preserve the stored order: only the surplus entries disappear.
	return rules.filter((rule) => keptIds.has(rule.id));
}

export type AdaptationProposal = {
	hostname: string;
	pathname: string;
	structureKey: string;
	source: AdaptationRule["source"];
	patch: AdaptationPatch;
};

export const AdaptationProposalSchema = z.strictObject({
	hostname: z.string().regex(/^[a-z0-9.-]{1,253}$/i),
	pathname: z.string().startsWith("/").max(500),
	structureKey: z.string().regex(/^[a-f0-9]{8}$/i),
	source: z.enum(["manual", "automatic"]),
	patch: AdaptationPatch,
});

export function normalizePathname(pathname: string): string {
	const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
	return path.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
}

export function matchesPath(pattern: string, pathname: string): boolean {
	const path = normalizePathname(pathname);
	if (pattern.endsWith("/*")) {
		const prefix = pattern.slice(0, -1);
		const child = path.startsWith(prefix) ? path.slice(prefix.length) : "";
		return child.length > 0 && !child.includes("/");
	}
	return path === pattern;
}

export function findAdaptationRule(
	rules: AdaptationRule[],
	hostname: string,
	pathname: string,
	structureKey: string,
): AdaptationRule | undefined {
	return rules
		.filter(
			(rule) =>
				rule.enabled &&
				rule.hostname === hostname &&
				rule.structureKey === structureKey &&
				rule.pathPatterns.some((pattern) => matchesPath(pattern, pathname)),
		)
		.sort((a, b) => {
			const specificity = (rule: AdaptationRule) =>
				Math.max(
					...rule.pathPatterns
						.filter((pattern) => matchesPath(pattern, pathname))
						.map((pattern) =>
							pattern.endsWith("/*")
								? pattern.length - 2
								: pattern.length + 1000,
						),
				);
			return (
				specificity(b) - specificity(a) ||
				Number(b.source === "manual") - Number(a.source === "manual") ||
				b.updatedAt - a.updatedAt
			);
		})[0];
}

const unique = (values: string[]) =>
	[...new Set(values.map((s) => s.trim()))].sort();

/**
 * Sanitize persisted rules before any reader touches them.
 *
 * Storage is written without validation, so a hand-edited or truncated entry
 * must degrade to "no rules" instead of throwing on the translation path.
 */
export function parseAdaptationRules(input: unknown): AdaptationRule[] {
	if (!Array.isArray(input)) return [];
	const rules: AdaptationRule[] = [];
	for (const entry of input) {
		// Per-entry parsing keeps one corrupt rule from disabling every other rule.
		const parsed = AdaptationRule.safeParse(entry);
		if (parsed.success) rules.push(parsed.data);
	}
	return rules;
}

export function normalizePatch(patch: AdaptationPatch): AdaptationPatch {
	return {
		roots: unique(patch.roots),
		excludes: unique(patch.excludes),
		includes: unique(patch.includes ?? []),
		promoteTags: unique(patch.promoteTags.map((tag) => tag.toUpperCase())),
	};
}

export function patchesEqual(a: AdaptationPatch, b: AdaptationPatch): boolean {
	return (
		JSON.stringify(normalizePatch(a)) === JSON.stringify(normalizePatch(b))
	);
}

/**
 * Parse and normalize a patch without touching the DOM.
 *
 * Returns undefined for structurally invalid or empty patches, which lets
 * callers tell "this rule is unusable" apart from "this rule matches nothing
 * right now".
 */
export function parsePatch(input: unknown): AdaptationPatch | undefined {
	const parsed = AdaptationPatch.safeParse(input);
	if (!parsed.success) return undefined;
	const patch = normalizePatch(parsed.data);
	if (
		patch.roots.length +
			patch.excludes.length +
			patch.includes.length +
			patch.promoteTags.length ===
		0
	)
		return undefined;
	for (const selector of [
		...patch.roots,
		...patch.excludes,
		...patch.includes,
	]) {
		// Keep model-suggested selectors cheap, stable, and declarative.
		if (!SAFE_SELECTOR_PATTERN.test(selector)) return undefined;
	}
	if (patch.promoteTags.some((tag) => !TEXT_TAGS.includes(tag)))
		return undefined;
	return patch;
}

function querySelectorMatches(
	selector: string,
	doc: Document,
): Element[] | undefined {
	try {
		const matches = [...doc.querySelectorAll(selector)];
		return matches.length > 0 && matches.length <= 40 ? matches : undefined;
	} catch {
		return undefined;
	}
}

function queryRuntimeSelector(
	selector: string,
	doc: Document,
): Element[] | undefined {
	try {
		const matches = [...doc.querySelectorAll(selector)];
		return matches.length <= 40 ? matches : undefined;
	} catch {
		return undefined;
	}
}

function validRootMatches(matches: Element[]): boolean {
	return !matches.some((el) =>
		el.closest("[contenteditable], [hidden], [aria-hidden='true']"),
	);
}

function validExcludeMatches(matches: Element[], doc: Document): boolean {
	return !matches.some((el) => el === doc.body || el === doc.documentElement);
}

function validIncludeMatches(matches: Element[], excludes: string[]): boolean {
	return !matches.some((el) => {
		if (
			!TEXT_TAGS.includes(el.tagName) ||
			!el.textContent?.trim() ||
			el.closest(
				[...excludes, REINCLUSION_TARGET_PROTECTED_SELECTOR].join(", "),
			)
		)
			return true;
		return el.querySelector(REINCLUSION_PROTECTED_DESCENDANTS) !== null;
	});
}

function validRuntimeIncludeMatches(
	matches: Element[],
	excludes: string[],
): boolean {
	return !matches.some((el) => {
		if (
			!TEXT_TAGS.includes(el.tagName) ||
			el.closest(
				[...excludes, REINCLUSION_TARGET_PROTECTED_SELECTOR].join(", "),
			)
		)
			return true;
		return el.querySelector(REINCLUSION_PROTECTED_DESCENDANTS) !== null;
	});
}

function removeRedundantIncludes(
	patch: AdaptationPatch,
	doc: Document,
): AdaptationPatch {
	// A broader included subtree makes nested include selectors redundant.
	const includedMatches = patch.includes.map((selector) => ({
		selector,
		elements: [...doc.querySelectorAll(selector)],
	}));
	const includes = includedMatches
		.filter(
			({ selector, elements }, index) =>
				!includedMatches.some((other, otherIndex) => {
					if (otherIndex === index) return false;
					const otherCovers = elements.every((element) =>
						other.elements.some(
							(parent) => parent === element || parent.contains(element),
						),
					);
					if (!otherCovers) return false;
					const sameCoverage = other.elements.every((element) =>
						elements.some(
							(parent) => parent === element || parent.contains(element),
						),
					);
					return !sameCoverage || other.selector < selector;
				}),
		)
		.map(({ selector }) => selector);
	return { ...patch, includes };
}

export function validatePatch(
	input: unknown,
	doc: Document,
): AdaptationPatch | undefined {
	const patch = parsePatch(input);
	if (!patch) return undefined;

	for (const selector of patch.roots) {
		const matches = querySelectorMatches(selector, doc);
		if (!matches || !validRootMatches(matches)) return undefined;
	}
	for (const selector of patch.excludes) {
		const matches = querySelectorMatches(selector, doc);
		if (!matches || !validExcludeMatches(matches, doc)) return undefined;
	}
	for (const selector of patch.includes) {
		const matches = querySelectorMatches(selector, doc);
		if (!matches || !validIncludeMatches(matches, patch.excludes))
			return undefined;
	}
	return removeRedundantIncludes(patch, doc);
}

/**
 * Revalidates persisted selectors against the current DOM independently.
 * Safe selectors with no current matches remain active so the parser can use
 * them when matching elements are added later.
 */
export function resolvePatchForDocument(
	input: unknown,
	doc: Document,
): AdaptationPatch | undefined {
	const patch = parsePatch(input);
	if (!patch) return undefined;

	const roots = patch.roots.filter((selector) => {
		const matches = queryRuntimeSelector(selector, doc);
		return (
			matches !== undefined &&
			(matches.length === 0 || validRootMatches(matches))
		);
	});
	const excludes = patch.excludes.filter((selector) => {
		const matches = queryRuntimeSelector(selector, doc);
		return (
			matches !== undefined &&
			(matches.length === 0 || validExcludeMatches(matches, doc))
		);
	});
	const includes = patch.includes.filter((selector) => {
		const matches = queryRuntimeSelector(selector, doc);
		return (
			matches !== undefined &&
			(matches.length === 0 || validRuntimeIncludeMatches(matches, excludes))
		);
	});
	const resolved = { ...patch, roots, excludes, includes };
	if (
		resolved.roots.length +
			resolved.excludes.length +
			resolved.includes.length +
			resolved.promoteTags.length ===
		0
	)
		return undefined;
	return resolved;
}

/** Mirror of the schema cap on AdaptationRule.pathPatterns. */
export const MAX_PATH_PATTERNS = 30;

function specificityScore(pattern: string): number {
	return pattern.endsWith("/*") ? pattern.length - 2 : pattern.length + 1000;
}

function siblingWildcard(a: string, b: string): string | undefined {
	const left = normalizePathname(a).split("/");
	const right = normalizePathname(b).split("/");
	if (left.length < 3 || left.length !== right.length) return undefined;
	if (left.at(-1) === right.at(-1)) return undefined;
	if (left.slice(0, -1).some((part, index) => part !== right[index]))
		return undefined;
	return `${left.slice(0, -1).join("/")}/*`;
}

export function extendPaths(patterns: string[], pathname: string): string[] {
	const path = normalizePathname(pathname);
	if (patterns.some((pattern) => matchesPath(pattern, path))) return patterns;
	const extended = extendPathsUnbounded(patterns, path);
	if (extended.length <= MAX_PATH_PATTERNS) return extended;
	// The schema caps pathPatterns, so growing past it would make the saved rule
	// invalid and block every future settings migration. Keep the most specific
	// patterns instead.
	return [...extended]
		.sort((a, b) => specificityScore(b) - specificityScore(a))
		.slice(0, MAX_PATH_PATTERNS)
		.sort();
}

function extendPathsUnbounded(patterns: string[], path: string): string[] {
	for (const pattern of patterns) {
		if (pattern.endsWith("/*")) continue;
		const wildcard = siblingWildcard(pattern, path);
		if (wildcard) {
			return [...patterns.filter((item) => item !== pattern), wildcard].sort();
		}
	}
	return [...patterns, path].sort();
}

export function upsertAdaptationRule(
	rules: AdaptationRule[],
	proposal: AdaptationProposal,
	now: number,
): { rules: AdaptationRule[]; result: "added" | "updated" | "unchanged" } {
	const patch = normalizePatch(proposal.patch);
	const pathname = normalizePathname(proposal.pathname);
	const exactIndex = rules.findIndex(
		(rule) =>
			rule.hostname === proposal.hostname &&
			rule.structureKey === proposal.structureKey &&
			rule.pathPatterns.includes(pathname),
	);
	let replacedExact = false;
	if (exactIndex >= 0) {
		const rule = rules[exactIndex];
		if (
			!rule.enabled ||
			(rule.source === "manual" && proposal.source === "automatic")
		)
			return { rules, result: "unchanged" };
		if (
			rule.structureKey === proposal.structureKey &&
			patchesEqual(rule.patch, patch)
		)
			return { rules, result: "unchanged" };
		if (rule.pathPatterns.length === 1) {
			return {
				rules: enforceRuleBudget(
					rules.map((item, i) =>
						i === exactIndex
							? {
									...rule,
									structureKey: proposal.structureKey,
									patch,
									source: proposal.source,
									updatedAt: now,
								}
							: item,
					),
				),
				result: "updated",
			};
		}
		// Keep the other pages in a shared rule when this page diverges.
		rules = rules.map((item, i) =>
			i === exactIndex
				? {
						...item,
						pathPatterns: item.pathPatterns.filter((p) => p !== pathname),
					}
				: item,
		);
		replacedExact = true;
	}
	const matchingIndex = rules.findIndex(
		(rule) =>
			rule.enabled &&
			rule.hostname === proposal.hostname &&
			rule.structureKey === proposal.structureKey &&
			patchesEqual(rule.patch, patch),
	);
	if (matchingIndex >= 0) {
		const rule = rules[matchingIndex];
		const pathPatterns = extendPaths(rule.pathPatterns, pathname);
		if (pathPatterns === rule.pathPatterns && !replacedExact)
			return { rules, result: "unchanged" };
		return {
			rules: enforceRuleBudget(
				rules.map((item, i) =>
					i === matchingIndex
						? { ...rule, pathPatterns, updatedAt: now }
						: item,
				),
			),
			result: "updated",
		};
	}
	const disabledWildcard = rules.some(
		(rule) =>
			rule.hostname === proposal.hostname &&
			!rule.enabled &&
			rule.structureKey === proposal.structureKey &&
			rule.pathPatterns.some((pattern) => matchesPath(pattern, pathname)),
	);
	if (disabledWildcard) return { rules, result: "unchanged" };
	return {
		rules: enforceRuleBudget([
			...rules,
			{
				id: crypto.randomUUID(),
				hostname: proposal.hostname,
				pathPatterns: [pathname],
				structureKey: proposal.structureKey,
				enabled: true,
				source: proposal.source,
				patch,
				createdAt: now,
				updatedAt: now,
			},
		]),
		result: replacedExact ? "updated" : "added",
	};
}
