import { browser } from "#imports";
import { STORAGE_KEYS } from "~/utils/constants";
import { getRootDomain } from "~/utils/domain";

export type PopupGeometry = {
	x: number;
	y: number;
	width: number;
	height: number;
	viewportWidth?: number;
	viewportHeight?: number;
};

type StoredPopupGeometry = PopupGeometry & {
	updatedAt: number;
};

type GeometryMap = Record<string, StoredPopupGeometry>;

const MIN_WIDTH = 200;
const MIN_HEIGHT = 150;

/** Cap the number of tracked domains to bound storage growth (LRU by updatedAt). */
const MAX_ENTRIES = 1000;

const hasValidViewport = (value: {
	viewportWidth?: unknown;
	viewportHeight?: unknown;
}): value is { viewportWidth: number; viewportHeight: number } =>
	typeof value.viewportWidth === "number" &&
	typeof value.viewportHeight === "number" &&
	Number.isFinite(value.viewportWidth) &&
	Number.isFinite(value.viewportHeight) &&
	value.viewportWidth > 0 &&
	value.viewportHeight > 0;

export function sanitizeGeometry(value: unknown): PopupGeometry | null {
	if (!value || typeof value !== "object") return null;
	const c = value as Record<string, unknown>;
	if (
		typeof c.x !== "number" ||
		typeof c.y !== "number" ||
		typeof c.width !== "number" ||
		typeof c.height !== "number"
	) {
		return null;
	}
	if (
		!Number.isFinite(c.x) ||
		!Number.isFinite(c.y) ||
		!Number.isFinite(c.width) ||
		!Number.isFinite(c.height)
	) {
		return null;
	}
	if (c.width < MIN_WIDTH || c.height < MIN_HEIGHT) return null;
	const geometry: PopupGeometry = {
		x: c.x,
		y: c.y,
		width: c.width,
		height: c.height,
	};
	if (hasValidViewport(c)) {
		geometry.viewportWidth = c.viewportWidth;
		geometry.viewportHeight = c.viewportHeight;
	}
	return geometry;
}

export function clampToViewport(
	geometry: PopupGeometry,
	vw: number,
	vh: number,
	margin = 12,
): PopupGeometry | null {
	if (vw < margin * 2 || vh < margin * 2) {
		return null;
	}
	if (
		geometry.x + geometry.width < margin ||
		geometry.y + geometry.height < margin ||
		geometry.x > vw - margin ||
		geometry.y > vh - margin
	) {
		return null;
	}
	const width = Math.min(geometry.width, vw - margin * 2);
	const height = Math.min(geometry.height, vh - margin * 2);
	return {
		x: Math.max(margin, Math.min(geometry.x, vw - width - margin)),
		y: Math.max(margin, Math.min(geometry.y, vh - height - margin)),
		width,
		height,
	};
}

/**
 * Adapt a saved popup geometry to the current viewport size.
 *
 * When the geometry carries its recorded viewport dimensions, both size and
 * position scale proportionally to the new viewport while respecting minimum
 * dimensions and viewport margins. Legacy geometries without recorded viewport
 * dimensions fall back to clamping.
 */
export function adaptGeometryToViewport(
	geometry: PopupGeometry,
	vw: number,
	vh: number,
	margin = 12,
): PopupGeometry | null {
	if (
		!Number.isFinite(vw) ||
		!Number.isFinite(vh) ||
		vw <= margin * 2 ||
		vh <= margin * 2
	) {
		return null;
	}

	if (!hasValidViewport(geometry)) {
		const clamped = clampToViewport(geometry, vw, vh, margin);
		return clamped
			? { ...clamped, viewportWidth: vw, viewportHeight: vh }
			: null;
	}

	const { viewportWidth: origVw, viewportHeight: origVh } = geometry;

	if (
		geometry.x + geometry.width < margin ||
		geometry.y + geometry.height < margin ||
		geometry.x > origVw - margin ||
		geometry.y > origVh - margin
	) {
		return null;
	}

	const maxWidth = vw - margin * 2;
	const maxHeight = vh - margin * 2;

	if (origVw === vw && origVh === vh) {
		const width = Math.min(geometry.width, maxWidth);
		const height = Math.min(geometry.height, maxHeight);
		return {
			x: Math.max(margin, Math.min(geometry.x, vw - width - margin)),
			y: Math.max(margin, Math.min(geometry.y, vh - height - margin)),
			width,
			height,
			viewportWidth: vw,
			viewportHeight: vh,
		};
	}

	const scaleX = vw / origVw;
	const scaleY = vh / origVh;

	const minWidth = Math.min(MIN_WIDTH, maxWidth);
	const minHeight = Math.min(MIN_HEIGHT, maxHeight);

	const width = Math.max(
		minWidth,
		Math.min(maxWidth, Math.round(geometry.width * scaleX)),
	);
	const height = Math.max(
		minHeight,
		Math.min(maxHeight, Math.round(geometry.height * scaleY)),
	);

	// Preserve relative placement within available free space. When width/height
	// scale without hitting min/max clamps this equals geometry.x * scaleX; when
	// clamped, it still keeps left/center/right alignment natural.
	const origSlackX = origVw - geometry.width;
	const newSlackX = vw - width;
	const scaledX =
		origSlackX > 0
			? (geometry.x / origSlackX) * newSlackX
			: geometry.x * scaleX;

	const origSlackY = origVh - geometry.height;
	const newSlackY = vh - height;
	const scaledY =
		origSlackY > 0
			? (geometry.y / origSlackY) * newSlackY
			: geometry.y * scaleY;

	return {
		x: Math.max(margin, Math.min(Math.round(scaledX), vw - width - margin)),
		y: Math.max(margin, Math.min(Math.round(scaledY), vh - height - margin)),
		width,
		height,
		viewportWidth: vw,
		viewportHeight: vh,
	};
}

// --- browser.storage.local backend ---
//
// Geometry is persisted in the extension's own storage (not the page origin's
// IndexedDB) so it survives browser restarts, storage cleanup, and the page
// clearing its own site data — the same storage layer used by page-state and
// settings. Keyed by root domain so all pages on a domain share one entry.

const readMap = async (): Promise<GeometryMap> => {
	const res = await browser.storage.local.get(
		STORAGE_KEYS.summaryPopupGeometry,
	);
	return (
		(res[STORAGE_KEYS.summaryPopupGeometry] as GeometryMap | undefined) ?? {}
	);
};

const writeMap = async (map: GeometryMap): Promise<void> => {
	if (Object.keys(map).length === 0) {
		await browser.storage.local.remove(STORAGE_KEYS.summaryPopupGeometry);
		return;
	}
	await browser.storage.local.set({
		[STORAGE_KEYS.summaryPopupGeometry]: map,
	});
};

/** Drop oldest entries (by updatedAt) until under the cap. */
const enforceCap = (map: GeometryMap, maxEntries: number): GeometryMap => {
	if (maxEntries <= 0) return map;
	const keys = Object.keys(map);
	if (keys.length <= maxEntries) return map;
	const sorted = keys.sort(
		(a, b) => (map[a].updatedAt ?? 0) - (map[b].updatedAt ?? 0),
	);
	const drop = sorted.length - maxEntries;
	const next: GeometryMap = { ...map };
	for (let i = 0; i < drop; i++) delete next[sorted[i]];
	return next;
};

// --- Public API ---

const getDomainKey = (url: string): string | null => {
	return getRootDomain(url);
};

export async function loadPopupGeometry(
	url: string,
): Promise<PopupGeometry | null> {
	const key = getDomainKey(url);
	if (!key) return null;
	const map = await readMap();
	return sanitizeGeometry(map[key]);
}

export async function savePopupGeometry(
	geometry: PopupGeometry,
	url: string,
	maxEntries = MAX_ENTRIES,
): Promise<void> {
	const key = getDomainKey(url);
	if (!key) return;
	const sanitized = sanitizeGeometry(geometry);
	if (!sanitized) return;
	const map = await readMap();
	map[key] = { ...sanitized, updatedAt: Date.now() };
	await writeMap(enforceCap(map, maxEntries));
}

export async function resetPopupGeometry(url: string): Promise<void> {
	const key = getDomainKey(url);
	if (!key) return;
	const map = await readMap();
	if (!(key in map)) return;
	delete map[key];
	await writeMap(map);
}
