import { describe, expect, test } from "bun:test";
import {
	formatBytes,
	formatLatency,
	formatPercent,
	formatRate,
} from "./format";

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

describe("formatLatency", () => {
	test("guards against zero and invalid input", () => {
		expect(formatLatency(0)).toBe("0 ms");
		expect(formatLatency(-5)).toBe("0 ms");
		expect(formatLatency(Number.NaN)).toBe("0 ms");
	});

	test("keeps whole milliseconds below one second", () => {
		expect(formatLatency(1)).toBe("1 ms");
		expect(formatLatency(820.4)).toBe("820 ms");
		expect(formatLatency(999)).toBe("999 ms");
	});

	test("switches to seconds with two decimals", () => {
		expect(formatLatency(1000)).toBe("1.00 s");
		expect(formatLatency(1240)).toBe("1.24 s");
		expect(formatLatency(12500)).toBe("12.50 s");
	});
});

describe("formatRate", () => {
	test("keeps one decimal", () => {
		expect(formatRate(42.34)).toBe("42.3");
		expect(formatRate(0.05)).toBe("0.1");
		expect(formatRate(50)).toBe("50.0");
	});

	test("reports zero for empty and invalid values", () => {
		expect(formatRate(0)).toBe("0.0");
		expect(formatRate(-3)).toBe("0.0");
		expect(formatRate(Number.NaN)).toBe("0.0");
	});
});
