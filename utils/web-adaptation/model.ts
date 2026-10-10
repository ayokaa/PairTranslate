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

/** Existing per-field limits, shared by additions and explicit removals. */
const MAX_EXCLUDES = 12;
const MAX_INCLUDES = 12;
const MAX_PROMOTE_TAGS = 8;

export const AdaptationPatch = z.strictObject({
	roots: z.array(Selector).default([]),
	excludes: z.array(Selector).max(MAX_EXCLUDES).default([]),
	// Match the existing per-rule exclusion-selector budget.
	includes: z.array(Selector).max(MAX_INCLUDES).default([]),
	promoteTags: z.array(Tag).max(MAX_PROMOTE_TAGS).default([]),
});
export type AdaptationPatch = z.infer<typeof AdaptationPatch>;

export const AdaptationSuggestion = AdaptationPatch.extend({
	// A removal cannot exceed the existing exclusion-selector budget.
	removeExcludes: z.array(Selector).max(MAX_EXCLUDES).default([]),
	reason: z.string().max(500).optional(),
});

const EMPTY_PATCH: AdaptationPatch = {
	roots: [],
	excludes: [],
	includes: [],
	promoteTags: [],
};

/**
 * Append a proposal to the patch currently in force.
 *
 * Omitting a field never drops saved selectors. An explicit exclusion removal
 * is the only subtraction and still needs an extraction trial before saving.
 * When a field is full, retained saved selectors win over new additions.
 */
export function appendAdaptationPatch(
	existing: AdaptationPatch | undefined,
	incoming: AdaptationPatch,
	removeExcludes: string[] = [],
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
		excludes: cappedUnion(
			base.excludes.filter((selector) => !removeExcludes.includes(selector)),
			addition.excludes,
			MAX_EXCLUDES,
		),
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
export function enforceRuleBudget(
	rules: AdaptationRule[],
	retainedRuleId?: string,
): AdaptationRule[] {
	if (rules.length <= MAX_RULES_PER_HOST) return rules;
	const perHost = new Map<string, number>();
	const keptIds = new Set<string>();
	// Always retain the verified rule, including after a clock rollback or an
	// import with future timestamps. Reverse iteration resolves other time ties.
	for (const rule of [...rules]
		.reverse()
		.sort(
			(a, b) =>
				Number(b.id === retainedRuleId) - Number(a.id === retainedRuleId) ||
				b.updatedAt - a.updatedAt,
		)) {
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
	legacyStructureKey?: string;
	/** Null means the trial used the default parser without a matching rule. */
	baselineRule: AdaptationRule | null;
	source: AdaptationRule["source"];
	patch: AdaptationPatch;
};

export const AdaptationProposalSchema = z.strictObject({
	hostname: z.string().regex(/^[a-z0-9.-]{1,253}$/i),
	pathname: z.string().startsWith("/").max(500),
	structureKey: z.string().regex(/^(?:layout:)?[a-f0-9]{8}$/i),
	legacyStructureKey: z
		.string()
		.regex(/^[a-f0-9]{8}$/i)
		.optional(),
	baselineRule: AdaptationRule.nullable(),
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
	options: { legacyStructureKey?: string; includeDisabled?: boolean } = {},
): AdaptationRule | undefined {
	const matched = rules
		.filter(
			(rule) =>
				rule.hostname === hostname &&
				(rule.structureKey === structureKey ||
					rule.structureKey === options.legacyStructureKey) &&
				rule.pathPatterns.some((pattern) => matchesPath(pattern, pathname)),
		)
		.sort((a, b) => {
			const specificity = (rule: AdaptationRule) =>
				Math.max(
					...rule.pathPatterns
						.filter((pattern) => matchesPath(pattern, pathname))
						.map(specificityScore),
				);
			return (
				specificity(b) - specificity(a) ||
				Number(b.source === "manual") - Number(a.source === "manual") ||
				b.updatedAt - a.updatedAt
			);
		})[0];
	// A disabled specific scope is also a deliberate override of a broader rule.
	return matched?.enabled || options.includeDisabled ? matched : undefined;
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

/** Compare the complete saved baseline used by a trial or stale-root scan. */
export function adaptationRulesEqual(
	a: AdaptationRule | null | undefined,
	b: AdaptationRule | null | undefined,
): boolean {
	const state = (rule: AdaptationRule | null | undefined) =>
		rule
			? JSON.stringify({
					id: rule.id,
					hostname: rule.hostname,
					structureKey: rule.structureKey,
					pathPatterns: [...rule.pathPatterns].sort(),
					patch: normalizePatch(rule.patch),
					enabled: rule.enabled,
					source: rule.source,
					createdAt: rule.createdAt,
					updatedAt: rule.updatedAt,
				})
			: undefined;
	return state(a) === state(b);
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
	// invalid and block every future settings migration. The verified page must
	// remain covered; retain its scope before the other most specific patterns.
	return [...extended]
		.sort(
			(a, b) =>
				Number(matchesPath(b, path)) - Number(matchesPath(a, path)) ||
				specificityScore(b) - specificityScore(a),
		)
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
): {
	rules: AdaptationRule[];
	result: "added" | "updated" | "unchanged" | "stale";
} {
	const patch = normalizePatch(proposal.patch);
	const pathname = normalizePathname(proposal.pathname);
	const currentRule = findAdaptationRule(
		rules,
		proposal.hostname,
		pathname,
		proposal.structureKey,
		{ legacyStructureKey: proposal.legacyStructureKey, includeDisabled: true },
	);
	if (currentRule?.enabled && patchesEqual(currentRule.patch, patch)) {
		return { rules, result: "unchanged" };
	}
	if (!adaptationRulesEqual(currentRule, proposal.baselineRule)) {
		// A full patch was verified against this baseline. Combining it with a
		// different saved patch without another trial would invalidate that proof.
		return { rules, result: "stale" };
	}
	if (
		currentRule &&
		(!currentRule.enabled ||
			(currentRule.source === "manual" && proposal.source === "automatic"))
	)
		return { rules, result: "unchanged" };
	if (Object.values(patch).every((items) => items.length === 0)) {
		if (!currentRule) return { rules, result: "unchanged" };
		if (
			currentRule.pathPatterns.length === 1 &&
			currentRule.pathPatterns.includes(pathname) &&
			!findAdaptationRule(
				rules.filter((rule) => rule.id !== currentRule.id),
				proposal.hostname,
				pathname,
				proposal.structureKey,
				{
					legacyStructureKey: proposal.legacyStructureKey,
					includeDisabled: true,
				},
			)
		) {
			return {
				rules: rules.filter((rule) => rule.id !== currentRule.id),
				result: "updated",
			};
		}
		// A shared wildcard still needs an exact empty override for this page;
		// deleting it would restore the wildcard's exclusion on the next scan.
	}
	const exactIndex = currentRule?.pathPatterns.includes(pathname)
		? rules.findIndex((rule) => rule.id === currentRule.id)
		: -1;
	let replacedExact = false;
	if (exactIndex >= 0) {
		const rule = rules[exactIndex];
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
					rule.id,
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
			rule.source === proposal.source &&
			rule.hostname === proposal.hostname &&
			rule.structureKey === proposal.structureKey &&
			// Extending an already-covered, lower-priority rule would leave the
			// different baseline active. This page needs an exact override instead.
			!rule.pathPatterns.some((pattern) => matchesPath(pattern, pathname)) &&
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
				rule.id,
			),
			result: "updated",
		};
	}
	const addedRule: AdaptationRule = {
		id: crypto.randomUUID(),
		hostname: proposal.hostname,
		pathPatterns: [pathname],
		structureKey: proposal.structureKey,
		enabled: true,
		source: proposal.source,
		patch,
		createdAt: now,
		updatedAt: now,
	};
	return {
		rules: enforceRuleBudget([...rules, addedRule], addedRule.id),
		result: replacedExact ? "updated" : "added",
	};
}
