import { describe, expect, mock, test } from "bun:test";

const storage = new Map<string, unknown>();

mock.module("#imports", () => ({
	browser: {
		storage: {
			local: {
				get: async (key: string | string[]) => {
					if (typeof key === "string") {
						return { [key]: storage.get(key) };
					}
					const result: Record<string, unknown> = {};
					for (const k of key) {
						result[k] = storage.get(k);
					}
					return result;
				},
				set: async (obj: Record<string, unknown>) => {
					for (const [k, v] of Object.entries(obj)) {
						storage.set(k, v);
					}
				},
			},
		},
	},
}));

const {
	sanitizeGeometry,
	clampToViewport,
	loadPopupGeometry,
	savePopupGeometry,
} = await import("./popup-storage");

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
		storage.clear();
		const result = await loadPopupGeometry();
		expect(result).toBeNull();
	});

	test("round-trips valid geometry", async () => {
		storage.clear();
		const geometry = { x: 100, y: 200, width: 420, height: 520 };
		await savePopupGeometry(geometry);
		const loaded = await loadPopupGeometry();
		expect(loaded).toEqual(geometry);
	});

	test("returns null for corrupted stored data", async () => {
		storage.clear();
		const { STORAGE_KEYS } = await import("~/utils/constants");
		storage.set(STORAGE_KEYS.summaryPopupGeometry, { x: "bad" });
		const result = await loadPopupGeometry();
		expect(result).toBeNull();
	});

	test("returns null for stored data with NaN values", async () => {
		storage.clear();
		const { STORAGE_KEYS } = await import("~/utils/constants");
		storage.set(STORAGE_KEYS.summaryPopupGeometry, {
			x: NaN,
			y: 0,
			width: 300,
			height: 300,
		});
		const result = await loadPopupGeometry();
		expect(result).toBeNull();
	});

	test("overwrites previous geometry on save", async () => {
		storage.clear();
		await savePopupGeometry({ x: 10, y: 10, width: 300, height: 300 });
		await savePopupGeometry({ x: 50, y: 50, width: 500, height: 600 });
		const result = await loadPopupGeometry();
		expect(result).toEqual({ x: 50, y: 50, width: 500, height: 600 });
	});
});
