import type { TranslateContext } from "./types";

const encoder = new TextEncoder();
export const computeCacheKey = async (
	promptId: string,
	modelId: string,
	text: string | string[] = "",
	ctx: TranslateContext,
	srcLang?: string,
	dstLang?: string,
) => {
	const D = "\u200C"; // Zero-width non-joiner to separate fields
	let str = `${promptId}${modelId}${D}${Array.isArray(text) ? text.join(D) : text}${D}`;
	if (ctx.surr) {
		if (ctx.surr.before) str += `${ctx.surr.before}${D}`;
		if (ctx.surr.after) str += `${ctx.surr.after}${D}`;
	}

	if (ctx.page) {
		// For hit rate, we only hash the domain of the page context
		str += ctx.page.domain;
	}

	// `ctx.pageContext` is intentionally excluded here. It is an LLM-generated
	// description of the page that is re-created on every page load (and per
	// tab), so hashing its wording would change the key on every reload and
	// invalidate every cached translation. It is only a soft hint in the
	// prompt; reusing a translation produced under a slightly different
	// wording of that hint is acceptable.

	if (srcLang) str += `${D}src:${srcLang}`;
	if (dstLang) str += `${D}dst:${dstLang}`;

	const buf = await crypto.subtle.digest("SHA-256", encoder.encode(str));
	return buf;
};
