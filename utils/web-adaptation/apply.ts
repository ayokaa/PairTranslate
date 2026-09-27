import type { Options } from "~/utils/parser/types";
import { type AdaptationPatch, validatePatch } from "./model";

export function applyAdaptationPatch(
	options: Options,
	patch: AdaptationPatch | undefined,
	doc: Document,
): Options {
	const valid = patch && validatePatch(patch, doc);
	if (!valid) return options;
	const roots = valid.roots.flatMap((selector) => [
		...doc.querySelectorAll(selector),
	]);
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
		...(distinctRoots.length > 0 && { roots: distinctRoots }),
		excludedSelectors: [
			...(options.excludedSelectors ?? []),
			...valid.excludes,
		],
		promoteTextTags: [...(options.promoteTextTags ?? []), ...valid.promoteTags],
	};
}
