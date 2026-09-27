import { describe, expect, test } from "bun:test";
import { formatBytes, formatPercent } from "./format";

describe("formatBytes", () => {
	test("reports zero and non-finite input as 0 B", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(-1)).toBe("0 B");
		expect(formatBytes(Number.NaN)).toBe("0 B");
		expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
	});

	test("keeps whole bytes free of decimals", () => {
		expect(formatBytes(1)).toBe("1 B");
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1023)).toBe("1023 B");
	});

	test("switches to binary units with one decimal", () => {
		expect(formatBytes(1024)).toBe("1.0 KB");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
		expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
		expect(formatBytes(1024 ** 4)).toBe("1.0 TB");
	});

	test("clamps to the largest known unit", () => {
		expect(formatBytes(1024 ** 5)).toBe("1024.0 TB");
	});
});

describe("formatPercent", () => {
	test("guards against a zero or invalid total", () => {
		expect(formatPercent(0, 0)).toBe("0%");
		expect(formatPercent(5, 0)).toBe("0%");
		expect(formatPercent(Number.NaN, 10)).toBe("0%");
		expect(formatPercent(5, Number.NaN)).toBe("0%");
	});

	test("rounds to a whole number", () => {
		expect(formatPercent(1, 3)).toBe("33%");
		expect(formatPercent(2, 3)).toBe("67%");
		expect(formatPercent(5, 10)).toBe("50%");
		expect(formatPercent(100, 100)).toBe("100%");
	});

	test("clamps outside 0-100", () => {
		expect(formatPercent(15, 10)).toBe("100%");
		expect(formatPercent(-5, 10)).toBe("0%");
	});
});
