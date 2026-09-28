import type { Options } from "~/utils/parser/types";
import { type AdaptationPatch, resolvePatchForDocument } from "./model";

export function applyAdaptationPatch(
	options: Options,
	patch: AdaptationPatch | undefined,
	doc: Document,
): Options {
	const valid = patch && resolvePatchForDocument(patch, doc);
	if (!valid) return patch?.roots.length ? { ...options, roots: [] } : options;
	const roots = valid.roots.flatMap((selector) => {
		try {
			return [...doc.querySelectorAll(selector)];
		} catch {
			return [];
		}
	});
	const distinctRoots = roots.filter(
		(root, index) =>
			!roots.some(
				(other, i) =>
					(i < index && other === root) ||
					(other !== root && other.contains(root)),
			),
	);
	return {
		...options,
		...(patch?.roots.length ? { roots: distinctRoots } : {}),
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
