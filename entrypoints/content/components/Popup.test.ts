import { describe, expect, test } from "bun:test";

describe("Popup content layout", () => {
	test("content slot fills remaining popup height", async () => {
		const source = await Bun.file(`${import.meta.dir}/Popup.tsx`).text();

		expect(source).toContain(
			'class="min-h-0 flex-1 overflow-y-auto overscroll-contain"',
		);
	});
});
