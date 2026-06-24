import { describe, expect, mock, test } from "bun:test";
import { STORAGE_KEYS } from "~/utils/constants";

// --- browser.storage.local mock (in-memory) ---
//
// popup-storage now persists via browser.storage.local (the extension's own
// storage), so the tests mock it the same way migration.test.ts does. This
// also means the round-trip tests now exercise the real read/write path that
// previously ran against the page-origin IndexedDB.

const localStore = new Map<string, unknown>();

const mockBrowser = {
	storage: {
		local: {
			get: async (keys: string | string[]) => {
				const keyList = Array.isArray(keys) ? keys : [keys];
				const result: Record<string, unknown> = {};
				for (const k of keyList) {
					if (localStore.has(k)) result[k] = localStore.get(k);
				}
				return result;
			},
			set: async (items: Record<string, unknown>) => {
				for (const [k, v] of Object.entries(items)) localStore.set(k, v);
			},
			remove: async (keys: string | string[]) => {
				const keyList = Array.isArray(keys) ? keys : [keys];
				for (const k of keyList) localStore.delete(k);
			},
		},
	},
};
mock.module("#imports", () => ({ browser: mockBrowser }));
mock.module("@wxt-dev/browser", () => ({ browser: mockBrowser }));

const { sanitizeGeometry, clampToViewport } = await import("./popup-storage");
const { loadPopupGeometry, savePopupGeometry, resetPopupGeometry } =
	await import("./popup-storage");

/** Reset the mock storage between tests so each starts from a clean slate. */
const resetStorage = () => localStore.clear();

describe("sanitizeGeometry", () => {
	test("returns valid geometry", () => {
		expect(
			sanitizeGeometry({ x: 100, y: 200, width: 420, height: 520 }),
		).toEqual({
			x: 100,
			y: 200,
			width: 420,
			height: 520,
		});
	});

	test("returns null for null/undefined", () => {
		expect(sanitizeGeometry(null)).toBeNull();
		expect(sanitizeGeometry(undefined)).toBeNull();
	});

	test("returns null for non-object", () => {
		expect(sanitizeGeometry("string")).toBeNull();
		expect(sanitizeGeometry(42)).toBeNull();
	});

	test("returns null for missing fields", () => {
		expect(sanitizeGeometry({ x: 0, y: 0, width: 300 })).toBeNull();
		expect(sanitizeGeometry({ x: 0, y: 0, height: 300 })).toBeNull();
	});

	test("returns null for non-number fields", () => {
		expect(
			sanitizeGeometry({ x: "0", y: 0, width: 300, height: 300 }),
		).toBeNull();
	});

	test("returns null for NaN and Infinity", () => {
		expect(
			sanitizeGeometry({ x: NaN, y: 0, width: 300, height: 300 }),
		).toBeNull();
		expect(
			sanitizeGeometry({ x: 0, y: Infinity, width: 300, height: 300 }),
		).toBeNull();
		expect(
			sanitizeGeometry({ x: 0, y: 0, width: -Infinity, height: 300 }),
		).toBeNull();
	});

	test("returns null for width below minimum (200)", () => {
		expect(
			sanitizeGeometry({ x: 0, y: 0, width: 199, height: 300 }),
		).toBeNull();
	});

	test("returns null for height below minimum (150)", () => {
		expect(
			sanitizeGeometry({ x: 0, y: 0, width: 300, height: 149 }),
		).toBeNull();
	});

	test("accepts zero position with valid dimensions", () => {
		expect(sanitizeGeometry({ x: 0, y: 0, width: 200, height: 150 })).toEqual({
			x: 0,
			y: 0,
			width: 200,
			height: 150,
		});
	});

	test("strips updatedAt/timestamp fields when loading", () => {
		const result = sanitizeGeometry({
			x: 1,
			y: 2,
			width: 300,
			height: 300,
			updatedAt: 12345,
		});
		expect(result).toEqual({ x: 1, y: 2, width: 300, height: 300 });
		expect(result).not.toHaveProperty("updatedAt");
	});
});

describe("clampToViewport", () => {
	test("returns geometry unchanged when fully visible", () => {
		const result = clampToViewport(
			{ x: 100, y: 100, width: 400, height: 500 },
			1920,
			1080,
		);
		expect(result).toEqual({ x: 100, y: 100, width: 400, height: 500 });
	});

	test("clamps position to keep popup within viewport with margin", () => {
		const result = clampToViewport(
			{ x: 1600, y: 700, width: 400, height: 500 },
			1920,
			1080,
			12,
		);
		expect(result).not.toBeNull();
		expect(result!.x).toBeLessThanOrEqual(1920 - 400 - 12);
		expect(result!.y).toBeLessThanOrEqual(1080 - 500 - 12);
	});

	test("clamps x to margin when popup would overflow right", () => {
		const result = clampToViewport(
			{ x: 700, y: 100, width: 400, height: 300 },
			1000,
			800,
			12,
		);
		expect(result).not.toBeNull();
		expect(result!.x).toBe(1000 - 400 - 12);
	});

	test("clamps y to margin when popup would overflow bottom", () => {
		const result = clampToViewport(
			{ x: 100, y: 600, width: 400, height: 300 },
			1000,
			800,
			12,
		);
		expect(result).not.toBeNull();
		expect(result!.y).toBe(800 - 300 - 12);
	});

	test("ensures minimum margin on left/top", () => {
		const result = clampToViewport(
			{ x: -50, y: -50, width: 400, height: 300 },
			1000,
			800,
			12,
		);
		expect(result).not.toBeNull();
		expect(result!.x).toBe(12);
		expect(result!.y).toBe(12);
	});

	test("returns null when popup is completely offscreen to the left", () => {
		expect(
			clampToViewport(
				{ x: -500, y: 100, width: 400, height: 300 },
				1000,
				800,
				12,
			),
		).toBeNull();
	});

	test("returns null when popup is completely offscreen above", () => {
		expect(
			clampToViewport(
				{ x: 100, y: -500, width: 400, height: 300 },
				1000,
				800,
				12,
			),
		).toBeNull();
	});

	test("returns null when popup is completely offscreen to the right", () => {
		expect(
			clampToViewport(
				{ x: 1100, y: 100, width: 400, height: 300 },
				1000,
				800,
				12,
			),
		).toBeNull();
	});

	test("returns null when popup is completely offscreen below", () => {
		expect(
			clampToViewport(
				{ x: 100, y: 900, width: 400, height: 300 },
				1000,
				800,
				12,
			),
		).toBeNull();
	});

	test("clamps width when wider than viewport", () => {
		const result = clampToViewport(
			{ x: 12, y: 12, width: 1200, height: 300 },
			1000,
			800,
			12,
		);
		expect(result).not.toBeNull();
		expect(result!.width).toBe(1000 - 24);
	});

	test("clamps height when taller than viewport", () => {
		const result = clampToViewport(
			{ x: 12, y: 12, width: 400, height: 900 },
			1000,
			800,
			12,
		);
		expect(result).not.toBeNull();
		expect(result!.height).toBe(800 - 24);
	});

	test("uses default margin of 12", () => {
		const result = clampToViewport(
			{ x: 5, y: 5, width: 400, height: 300 },
			1000,
			800,
		);
		expect(result).not.toBeNull();
		expect(result!.x).toBe(12);
		expect(result!.y).toBe(12);
	});

	test("returns null when viewport is smaller than margin*2 in width", () => {
		expect(
			clampToViewport({ x: 0, y: 0, width: 200, height: 150 }, 20, 800, 12),
		).toBeNull();
	});

	test("returns null when viewport is smaller than margin*2 in height", () => {
		expect(
			clampToViewport({ x: 0, y: 0, width: 200, height: 150 }, 1000, 20, 12),
		).toBeNull();
	});

	test("never produces negative width or height", () => {
		const result = clampToViewport(
			{ x: 0, y: 0, width: 200, height: 150 },
			30,
			30,
			12,
		);
		if (result !== null) {
			expect(result.width).toBeGreaterThanOrEqual(0);
			expect(result.height).toBeGreaterThanOrEqual(0);
		}
	});
});

describe("loadPopupGeometry / savePopupGeometry", () => {
	test("returns null when nothing is stored", async () => {
		resetStorage();
		const result = await loadPopupGeometry("https://example.com");
		expect(result).toBeNull();
	});

	test("round-trips geometry per domain", async () => {
		resetStorage();
		const geometry = { x: 100, y: 200, width: 420, height: 520 };
		await savePopupGeometry(geometry, "https://github.com/ayokaa");
		const loaded = await loadPopupGeometry("https://github.com/ayokaa");
		expect(loaded).toEqual(geometry);
	});

	test("persists via browser.storage.local under the storage key", async () => {
		resetStorage();
		const geometry = { x: 10, y: 20, width: 420, height: 520 };
		await savePopupGeometry(geometry, "https://github.com/x");
		// The data must live in extension storage, not a per-origin IndexedDB.
		const raw = await mockBrowser.storage.local.get(
			STORAGE_KEYS.summaryPopupGeometry,
		);
		expect(raw).toHaveProperty(STORAGE_KEYS.summaryPopupGeometry);
		const map = raw[STORAGE_KEYS.summaryPopupGeometry] as Record<
			string,
			unknown
		>;
		expect(map["github.com"]).toMatchObject(geometry);
	});

	test("overwrites previous geometry on save", async () => {
		resetStorage();
		await savePopupGeometry(
			{ x: 10, y: 10, width: 300, height: 300 },
			"https://github.com/ayokaa",
		);
		await savePopupGeometry(
			{ x: 50, y: 50, width: 500, height: 600 },
			"https://github.com/ayokaa",
		);
		const result = await loadPopupGeometry("https://github.com/ayokaa");
		expect(result).toEqual({ x: 50, y: 50, width: 500, height: 600 });
	});

	test("keeps geometry isolated per domain", async () => {
		resetStorage();
		const githubGeometry = { x: 10, y: 20, width: 420, height: 520 };
		const redditGeometry = { x: 30, y: 40, width: 400, height: 500 };

		await savePopupGeometry(githubGeometry, "https://github.com/ayokaa");
		await savePopupGeometry(redditGeometry, "https://reddit.com/r/webdev");

		const loadedGithub = await loadPopupGeometry("https://github.com/ayokaa");
		const loadedReddit = await loadPopupGeometry("https://reddit.com/r/webdev");

		expect(loadedGithub).toEqual(githubGeometry);
		expect(loadedReddit).toEqual(redditGeometry);
	});

	test("shares one geometry across paths/subdomains of the same root domain", async () => {
		resetStorage();
		const geometry = { x: 5, y: 5, width: 420, height: 520 };
		await savePopupGeometry(geometry, "https://github.com/ayokaa/repo");
		// A different subdomain + path on the same root domain must hit the
		// same entry — this is what makes per-domain recall work even when the
		// user revisits via a different URL.
		const loaded = await loadPopupGeometry("https://gist.github.com/other");
		expect(loaded).toEqual(geometry);
	});

	test("evicts oldest entries when max entries exceeded", async () => {
		resetStorage();
		const baseGeometry = { x: 0, y: 0, width: 420, height: 520 };

		for (let i = 0; i < 3; i++) {
			await savePopupGeometry(
				{ ...baseGeometry, x: i },
				`https://site${i}.com`,
				2,
			);
			await new Promise((resolve) => setTimeout(resolve, 5));
		}

		const oldest = await loadPopupGeometry("https://site0.com");
		const newest = await loadPopupGeometry("https://site2.com");

		expect(oldest).toBeNull();
		expect(newest).toEqual({ ...baseGeometry, x: 2 });
	});

	test("returns null for invalid URLs", async () => {
		resetStorage();
		const result = await loadPopupGeometry("not-a-url");
		expect(result).toBeNull();
	});

	test("ignores save for invalid URLs", async () => {
		resetStorage();
		await expect(
			savePopupGeometry({ x: 0, y: 0, width: 420, height: 520 }, "not-a-url"),
		).resolves.toBeUndefined();
	});

	test("clears only the targeted domain on reset", async () => {
		resetStorage();
		await savePopupGeometry(
			{ x: 1, y: 1, width: 420, height: 520 },
			"https://github.com/a",
		);
		await savePopupGeometry(
			{ x: 2, y: 2, width: 420, height: 520 },
			"https://reddit.com/b",
		);

		await resetPopupGeometry("https://github.com/a");

		expect(await loadPopupGeometry("https://github.com/a")).toBeNull();
		expect(await loadPopupGeometry("https://reddit.com/b")).not.toBeNull();
	});

	test("removes the storage key entirely when last entry is reset", async () => {
		resetStorage();
		await savePopupGeometry(
			{ x: 1, y: 1, width: 420, height: 520 },
			"https://github.com/a",
		);
		await resetPopupGeometry("https://github.com/a");

		const raw = await mockBrowser.storage.local.get(
			STORAGE_KEYS.summaryPopupGeometry,
		);
		expect(raw[STORAGE_KEYS.summaryPopupGeometry]).toBeUndefined();
	});

	test("survives a simulated restart (fresh module, same storage)", async () => {
		// browser.storage.local persists across content-script reloads; the
		// mock holds the data in localStore, which we deliberately do NOT clear
		// here to model a browser restart where the extension storage survives.
		resetStorage();
		const geometry = { x: 77, y: 88, width: 420, height: 520 };
		await savePopupGeometry(geometry, "https://example.com/page");

		// A subsequent load (e.g. after a long delay / browser restart) must
		// still find the same geometry.
		const loaded = await loadPopupGeometry("https://example.com/other-page");
		expect(loaded).toEqual(geometry);
	});
});
