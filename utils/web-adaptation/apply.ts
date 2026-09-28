import type { Options } from "~/utils/parser/types";
import {
	type AdaptationPatch,
	parsePatch,
	resolvePatchForDocument,
} from "./model";

function distinctRootElements(selectors: string[], doc: Document): Element[] {
	const roots = selectors.flatMap((selector) => {
		try {
			return [...doc.querySelectorAll(selector)];
		} catch {
			return [];
		}
	});
	return roots.filter(
		(root, index) =>
			!roots.some(
				(other, i) =>
					(i < index && other === root) ||
					(other !== root && other.contains(root)),
			),
	);
}

/**
 * The elements a patch restricts the traversal to.
 *
 * An empty result means the patch declares roots but none of them match the
 * current document.
 */
export function resolveAdaptationRoots(
	patch: AdaptationPatch | undefined,
	doc: Document,
): Element[] {
	if (!patch?.roots.length) return [];
	return distinctRootElements(patch.roots, doc);
}

/**
 * Whether a patch declares content roots that no longer match the document.
 *
 * A stale rule must never stop translation: the caller falls back to the
 * default scan and drops the rule.
 */
export function hasStaleAdaptationRoots(
	patch: AdaptationPatch | undefined,
	doc: Document,
): boolean {
	const parsed = patch && parsePatch(patch);
	if (!parsed?.roots.length) return false;
	// Resolve exactly like the runtime does: roots dropped by the match-count,
	// hidden or editable filters are as unusable as roots that match nothing.
	// Using the unfiltered match list here would call such a rule "fresh" and
	// keep it applied while its boundary is silently ignored.
	const valid = resolvePatchForDocument(parsed, doc);
	if (!valid?.roots.length) return true;
	return resolveAdaptationRoots(valid, doc).length === 0;
}

export function applyAdaptationPatch(
	options: Options,
	patch: AdaptationPatch | undefined,
	doc: Document,
): Options {
	const valid = patch && resolvePatchForDocument(patch, doc);
	if (!valid) {
		// A patch that cannot even be parsed is ignored, so corrupt storage is
		// treated as "no rule" instead of halting translation.
		return options;
	}
	const distinctRoots = patch?.roots.length
		? distinctRootElements(valid.roots, doc)
		: [];
	return {
		...options,
		// Roots that no longer match leave the scan scope untouched: the page
		// keeps being translated while the stale rule is removed.
		...(distinctRoots.length ? { roots: distinctRoots } : {}),
		includedSelectors: [
			...(options.includedSelectors ?? []),
			...valid.includes,
		],
		protectedExcludedSelectors: [
			...(options.protectedExcludedSelectors ?? []),
			...valid.excludes,
		],
		promoteTextTags: [...(options.promoteTextTags ?? []), ...valid.promoteTags],
	};
}
