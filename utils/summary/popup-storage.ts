import { browser } from "#imports";
import { STORAGE_KEYS } from "~/utils/constants";

export type PopupGeometry = {
	x: number;
	y: number;
	width: number;
	height: number;
};

const MIN_WIDTH = 200;
const MIN_HEIGHT = 150;

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
	return { x: c.x, y: c.y, width: c.width, height: c.height };
}

export function clampToViewport(
	geometry: PopupGeometry,
	vw: number,
	vh: number,
	margin = 12,
): PopupGeometry | null {
	if (
		geometry.x + geometry.width < margin ||
		geometry.y + geometry.height < margin ||
		geometry.x > vw - margin ||
		geometry.y > vh - margin
	) {
		return null;
	}
	return {
		x: Math.max(margin, Math.min(geometry.x, vw - geometry.width - margin)),
		y: Math.max(margin, Math.min(geometry.y, vh - geometry.height - margin)),
		width: Math.min(geometry.width, vw - margin * 2),
		height: Math.min(geometry.height, vh - margin * 2),
	};
}

export async function loadPopupGeometry(): Promise<PopupGeometry | null> {
	const res = await browser.storage.local.get(
		STORAGE_KEYS.summaryPopupGeometry,
	);
	return sanitizeGeometry(res[STORAGE_KEYS.summaryPopupGeometry]);
}

export async function savePopupGeometry(
	geometry: PopupGeometry,
): Promise<void> {
	await browser.storage.local.set({
		[STORAGE_KEYS.summaryPopupGeometry]: geometry,
	});
}
