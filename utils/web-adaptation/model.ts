import { z } from "zod";
import { TEXT_TAGS } from "~/utils/constants";

const Selector = z.string().trim().min(1).max(180);
const Tag = z.string().regex(/^[a-zA-Z][a-zA-Z0-9-]{0,15}$/);

export const AdaptationPatch = z.strictObject({
	roots: z.array(Selector).max(3).default([]),
	excludes: z.array(Selector).max(12).default([]),
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
		promoteTags: unique(patch.promoteTags.map((tag) => tag.toUpperCase())),
	};
}

export function patchesEqual(a: AdaptationPatch, b: AdaptationPatch): boolean {
	return (
		JSON.stringify(normalizePatch(a)) === JSON.stringify(normalizePatch(b))
	);
}

export function validatePatch(
	input: unknown,
	doc: Document,
): AdaptationPatch | undefined {
	const parsed = AdaptationPatch.safeParse(input);
	if (!parsed.success) return undefined;
	const patch = normalizePatch(parsed.data);
	if (
		patch.roots.length + patch.excludes.length + patch.promoteTags.length ===
		0
	)
		return undefined;

	for (const selector of [...patch.roots, ...patch.excludes]) {
		// Keep model-suggested selectors cheap, stable, and declarative.
		if (!/^[-a-zA-Z0-9_#. >[\]="'^$]+$/.test(selector)) return undefined;
		try {
			const matches = doc.querySelectorAll(selector);
			if (matches.length === 0 || matches.length > 40) return undefined;
			if (
				patch.roots.includes(selector) &&
				[...matches].some((el) =>
					el.closest("[contenteditable], [hidden], [aria-hidden='true']"),
				)
			)
				return undefined;
			if (
				patch.excludes.includes(selector) &&
				[...matches].some((el) => el === doc.body || el === doc.documentElement)
			)
				return undefined;
		} catch {
			return undefined;
		}
	}
	if (patch.promoteTags.some((tag) => !TEXT_TAGS.includes(tag)))
		return undefined;
	return patch;
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
