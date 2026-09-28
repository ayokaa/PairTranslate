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

function parsePatch(input: unknown): AdaptationPatch | undefined {
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
				rules: rules.map((item, i) =>
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
			rules: rules.map((item, i) =>
				i === matchingIndex ? { ...rule, pathPatterns, updatedAt: now } : item,
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
		rules: [
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
		],
		result: replacedExact ? "updated" : "added",
	};
}
