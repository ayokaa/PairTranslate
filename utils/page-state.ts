import { browser } from "#imports";
import { STORAGE_KEYS } from "~/utils/constants";

/**
 * Per-URL render state that should survive a page reload or browser restart.
 *
 * The actual translation *results* already live in the background's IndexedDB
 * LRU cache (keyed by promptId/modelId/text/domain/langs). What is volatile is
 * the UI state that decides *whether* to render: the in-text translation switch
 * and the summary popup open/close flag. This module persists exactly that.
 */
export type PageState = {
	translateEnabled: boolean;
	summaryOpen: boolean;
};

type StoredPageState = PageState & { updatedAt: number };

type PageStateMap = Record<string, StoredPageState>;

/** Cap the number of tracked URLs to bound storage growth (LRU by updatedAt). */
const MAX_ENTRIES = 500;

const sanitizeState = (value: unknown): PageState | undefined => {
	if (!value || typeof value !== "object") return undefined;
	const v = value as Partial<StoredPageState>;
	if (typeof v.translateEnabled !== "boolean") return undefined;
	if (typeof v.summaryOpen !== "boolean") return undefined;
	return { translateEnabled: v.translateEnabled, summaryOpen: v.summaryOpen };
};

const readMap = async (): Promise<PageStateMap> => {
	const res = await browser.storage.local.get(STORAGE_KEYS.pageState);
	return (res[STORAGE_KEYS.pageState] as PageStateMap | undefined) ?? {};
};

const writeMap = async (map: PageStateMap): Promise<void> => {
	if (Object.keys(map).length === 0) {
		await browser.storage.local.remove(STORAGE_KEYS.pageState);
		return;
	}
	await browser.storage.local.set({ [STORAGE_KEYS.pageState]: map });
};

/** Drop oldest entries (by updatedAt) until under the cap. */
const enforceCap = (map: PageStateMap): PageStateMap => {
	const keys = Object.keys(map);
	if (keys.length <= MAX_ENTRIES) return map;
	const sorted = keys.sort(
		(a, b) => (map[a].updatedAt ?? 0) - (map[b].updatedAt ?? 0),
	);
	const drop = sorted.length - MAX_ENTRIES;
	const next: PageStateMap = { ...map };
	for (let i = 0; i < drop; i++) delete next[sorted[i]];
	return next;
};

export async function loadPageState(
	url: string,
): Promise<PageState | undefined> {
	const map = await readMap();
	return sanitizeState(map[url]);
}

export async function savePageState(
	url: string,
	patch: Partial<PageState>,
): Promise<void> {
	if (!url) return;
	const map = await readMap();
	const prev = sanitizeState(map[url]) ?? {
		translateEnabled: false,
		summaryOpen: false,
	};
	const next: StoredPageState = {
		...prev,
		...patch,
		updatedAt: Date.now(),
	};
	map[url] = next;
	await writeMap(enforceCap(map));
}

export async function clearPageState(url: string): Promise<void> {
	if (!url) return;
	const map = await readMap();
	if (!(url in map)) return;
	delete map[url];
	await writeMap(map);
}
