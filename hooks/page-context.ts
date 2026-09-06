import { createEffect, createSignal, onCleanup } from "solid-js";
import { PROMPT_ID } from "~/utils/constants";
import { getPageContext } from "~/utils/page-context";
import { createLogger } from "~/utils/rpc/logger";
import { extractPageContent } from "~/utils/summary/extract";
import type { TranslateContext } from "~/utils/types";

const logger = createLogger(
	import.meta.env.DEV ? "debug" : "error",
	"PageContext",
);

export const MAX_PAGE_CONTEXT_CHARS = 20000;

type CacheEntry = {
	text: string;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string | undefined>>();
const failed = new Set<string>();
const [cacheVersion, setCacheVersion] = createSignal(0);

// Same-page fragment navigation (footnote refs, heading anchors, TOC links)
// changes only location.hash; the page content — and thus its context — is
// identical. Keying the cache by the bare URL prevents a hash click from
// invalidating the context and re-requesting every in-text translation.
const stripFragment = (url: string): string => {
	const i = url.indexOf("#");
	return i === -1 ? url : url.slice(0, i);
};

const cacheKey = (
	url: string,
	modelId: string,
	srcLang: string,
	dstLang: string,
) => `url:${stripFragment(url)} model:${modelId} src:${srcLang} dst:${dstLang}`;

const truncateToLength = (content: string, maxLength: number): string => {
	if (content.length <= maxLength) return content;
	const truncated = content.slice(0, maxLength);
	const lastBreak = truncated.lastIndexOf("\n\n");
	if (lastBreak > maxLength * 0.8) return truncated.slice(0, lastBreak);
	return truncated;
};

export const getCachedPageContext = (
	url: string,
	modelId: string | undefined,
	srcLang: string,
	dstLang: string,
): string | undefined => {
	if (!modelId) return undefined;
	cacheVersion();
	return cache.get(cacheKey(url, modelId, srcLang, dstLang))?.text;
};

export const ensurePageContext = async (options: {
	modelId: string;
	srcLang: string;
	dstLang: string;
	url?: string;
}): Promise<string | undefined> => {
	const url = options.url ?? window.location.href;
	const key = cacheKey(url, options.modelId, options.srcLang, options.dstLang);
	const hit = cache.get(key);
	if (hit) return hit.text;
	if (failed.has(key)) return undefined;
	const running = inflight.get(key);
	if (running) return running;

	const task = (async () => {
		try {
			const { content } = extractPageContent();
			const text = truncateToLength(content, MAX_PAGE_CONTEXT_CHARS).trim();
			if (!text) {
				failed.add(key);
				return undefined;
			}
			const ctx: TranslateContext = { page: getPageContext() };
			const resp = await window.rpc.unary(
				ctx,
				{
					modelId: options.modelId,
					promptId: PROMPT_ID.pageContext,
					srcLang: options.srcLang,
					dstLang: options.dstLang,
				},
				text,
			);
			const output = Array.isArray(resp.output)
				? resp.output.join("\n")
				: (resp.output ?? "");
			const trimmed = output.trim();
			if (!trimmed) {
				failed.add(key);
				return undefined;
			}
			cache.set(key, { text: trimmed });
			setCacheVersion((v) => v + 1);
			return trimmed;
		} catch (error) {
			logger.warn("Failed to generate page context:", error);
			failed.add(key);
			return undefined;
		} finally {
			inflight.delete(key);
		}
	})();

	inflight.set(key, task);
	return task;
};

export function usePageContext(options: {
	modelId: () => string | undefined;
	srcLang: () => string;
	dstLang: () => string;
	active: () => boolean;
}) {
	const [url, setUrl] = createSignal("");

	createEffect(() => {
		if (!options.active()) return;
		setUrl(stripFragment(window.location.href));
		const timer = window.setInterval(() => {
			const current = stripFragment(window.location.href);
			if (current !== url()) setUrl(current);
		}, 2000);
		onCleanup(() => window.clearInterval(timer));
	});

	createEffect(() => {
		const modelId = options.modelId();
		if (!modelId || !options.active()) return;
		const currentUrl = url();
		if (!currentUrl) return;
		const srcLang = options.srcLang();
		const dstLang = options.dstLang();
		const key = cacheKey(currentUrl, modelId, srcLang, dstLang);
		if (cache.has(key) || failed.has(key) || inflight.has(key)) return;
		void ensurePageContext({ modelId, srcLang, dstLang, url: currentUrl });
	});

	const text = () =>
		getCachedPageContext(
			url(),
			options.modelId(),
			options.srcLang(),
			options.dstLang(),
		);

	const ready = () => {
		const modelId = options.modelId();
		if (!modelId) return true;
		cacheVersion();
		const key = cacheKey(url(), modelId, options.srcLang(), options.dstLang());
		return cache.has(key) || failed.has(key);
	};

	return { text, ready };
}
