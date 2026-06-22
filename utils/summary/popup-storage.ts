import { browser } from "#imports";
import { STORAGE_KEYS } from "~/utils/constants";
import { getRootDomain } from "~/utils/domain";

export type PopupGeometry = {
	x: number;
	y: number;
	width: number;
	height: number;
};

type StoredPopupGeometry = PopupGeometry & {
	updatedAt: number;
};

type GeometryBackend = {
	get: (key: string) => Promise<PopupGeometry | null>;
	set: (key: string, geometry: PopupGeometry) => Promise<void>;
	delete: (key: string) => Promise<void>;
	getAllEntries: () => Promise<Array<{ key: string; updatedAt: number }>>;
	clear: () => Promise<void>;
};

const MIN_WIDTH = 200;
const MIN_HEIGHT = 150;

const DB_NAME = "pair-translate";
const DB_VERSION = 1;
const STORE_NAME = "summary-popup-geometry";

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
	return {
		x: Math.max(margin, Math.min(geometry.x, vw - geometry.width - margin)),
		y: Math.max(margin, Math.min(geometry.y, vh - geometry.height - margin)),
		width: Math.min(geometry.width, vw - margin * 2),
		height: Math.min(geometry.height, vh - margin * 2),
	};
}

// --- Backend selection: IndexedDB in browser, in-memory in tests ---

let backend: GeometryBackend | null = null;

const createMemoryBackend = (): GeometryBackend => {
	const map = new Map<string, StoredPopupGeometry>();
	return {
		get: async (key) => sanitizeGeometry(map.get(key)),
		set: async (key, geometry) => {
			map.set(key, { ...geometry, updatedAt: Date.now() });
		},
		delete: async (key) => {
			map.delete(key);
		},
		getAllEntries: async () =>
			Array.from(map.entries()).map(([key, value]) => ({
				key,
				updatedAt: value.updatedAt,
			})),
		clear: async () => {
			map.clear();
		},
	};
};

const openDb = (): Promise<IDBDatabase> => {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
};

const createIndexedDbBackend = (): GeometryBackend => {
	return {
		get: async (key) => {
			const db = await openDb();
			return new Promise((resolve, reject) => {
				const tx = db.transaction(STORE_NAME, "readonly");
				const store = tx.objectStore(STORE_NAME);
				const request = store.get(key);
				request.onsuccess = () => {
					resolve(sanitizeGeometry(request.result));
				};
				request.onerror = () => reject(request.error);
			});
		},
		set: async (key, geometry) => {
			const db = await openDb();
			return new Promise((resolve, reject) => {
				const tx = db.transaction(STORE_NAME, "readwrite");
				const store = tx.objectStore(STORE_NAME);
				const value: StoredPopupGeometry = {
					...geometry,
					updatedAt: Date.now(),
				};
				store.put(value, key);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
		},
		delete: async (key) => {
			const db = await openDb();
			return new Promise((resolve, reject) => {
				const tx = db.transaction(STORE_NAME, "readwrite");
				const store = tx.objectStore(STORE_NAME);
				store.delete(key);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
		},
		getAllEntries: async () => {
			const db = await openDb();
			return new Promise((resolve, reject) => {
				const tx = db.transaction(STORE_NAME, "readonly");
				const store = tx.objectStore(STORE_NAME);
				const request = store.openCursor();
				const entries: Array<{ key: string; updatedAt: number }> = [];
				request.onsuccess = (event) => {
					const cursor = (event.target as IDBRequest<IDBCursorWithValue>)
						.result;
					if (cursor) {
						const value = cursor.value as StoredPopupGeometry;
						entries.push({
							key: cursor.key as string,
							updatedAt: value.updatedAt,
						});
						cursor.continue();
					} else {
						resolve(entries);
					}
				};
				request.onerror = () => reject(request.error);
			});
		},
		clear: async () => {
			const db = await openDb();
			return new Promise((resolve, reject) => {
				const tx = db.transaction(STORE_NAME, "readwrite");
				const store = tx.objectStore(STORE_NAME);
				store.clear();
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
		},
	};
};

const getBackend = (): GeometryBackend => {
	if (!backend) {
		backend =
			typeof indexedDB !== "undefined"
				? createIndexedDbBackend()
				: createMemoryBackend();
	}
	return backend;
};

/** Reset the in-memory backend; intended for tests only. */
export function __resetGeometryBackend(): void {
	backend = null;
}

// --- Domain helpers ---

const getDomainKey = (url?: string): string | null => {
	if (!url) return null;
	return getRootDomain(url);
};

const enforceCap = async (maxEntries: number): Promise<void> => {
	if (maxEntries <= 0) return;
	const b = getBackend();
	const entries = await b.getAllEntries();
	if (entries.length <= maxEntries) return;
	const sorted = entries.sort((a, b) => a.updatedAt - b.updatedAt);
	const toRemove = sorted.slice(0, entries.length - maxEntries);
	await Promise.all(toRemove.map((entry) => b.delete(entry.key)));
};

// --- Global geometry fallback (storage.local) ---

const loadGlobalGeometry = async (): Promise<PopupGeometry | null> => {
	const res = await browser.storage.local.get(
		STORAGE_KEYS.summaryPopupGeometry,
	);
	return sanitizeGeometry(res[STORAGE_KEYS.summaryPopupGeometry]);
};

const saveGlobalGeometry = async (geometry: PopupGeometry): Promise<void> => {
	await browser.storage.local.set({
		[STORAGE_KEYS.summaryPopupGeometry]: geometry,
	});
};

// --- Public API ---

export async function loadPopupGeometry(
	url?: string,
	perSite = false,
): Promise<PopupGeometry | null> {
	if (perSite) {
		const key = getDomainKey(url);
		if (key) {
			const geometry = await getBackend().get(key);
			if (geometry) return geometry;
		}
	}
	return loadGlobalGeometry();
}

export async function savePopupGeometry(
	geometry: PopupGeometry,
	url?: string,
	perSite = false,
	maxEntries = 1000,
): Promise<void> {
	if (perSite) {
		const key = getDomainKey(url);
		if (key) {
			await getBackend().set(key, geometry);
			await enforceCap(maxEntries);
			return;
		}
	}
	await saveGlobalGeometry(geometry);
}

export async function resetPopupGeometry(
	url?: string,
	perSite = false,
): Promise<void> {
	if (perSite) {
		const key = getDomainKey(url);
		if (key) {
			await getBackend().delete(key);
			return;
		}
	}
	await browser.storage.local.remove(STORAGE_KEYS.summaryPopupGeometry);
}
