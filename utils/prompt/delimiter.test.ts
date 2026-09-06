import { describe, expect, test } from "bun:test";

import {
	alignSegments,
	resolveStringArrayDelimiter,
	type StringArrayStepOutput,
	splitWithDelimiter,
	splitWithDelimiterDetailed,
	stripOuterFence,
} from "./delimiter";

const createStringArrayOutput = (
	delimiter: StringArrayStepOutput["delimiter"],
): StringArrayStepOutput => ({
	type: "stringArray",
	delimiter,
});

describe("resolveStringArrayDelimiter", () => {
	test("returns literal delimiters as-is", () => {
		const output = createStringArrayOutput("<end>");
		const delimiter = resolveStringArrayDelimiter(output);
		expect(delimiter).toBe("<end>");
	});

	test("compiles regex delimiters with default flags", () => {
		const output = createStringArrayOutput({
			type: "regex",
			pattern: "^## Paragraph \\d+$",
		});
		const delimiter = resolveStringArrayDelimiter(output);
		expect(delimiter).toBeInstanceOf(RegExp);
		const sample = "## Paragraph 1\nFirst\n## Paragraph 2\nSecond";
		const result = splitWithDelimiter(sample, delimiter);
		expect(result).toEqual(["First", "Second"]);
	});

	test("throws helpful error for invalid regex", () => {
		const output = createStringArrayOutput({
			type: "regex",
			pattern: "(",
		});
		expect(() => resolveStringArrayDelimiter(output)).toThrow(
			/Invalid regex delimiter/,
		);
	});
});

describe("splitWithDelimiter", () => {
	test("trims entries and drops blanks", () => {
		const delimiter = /--split--/g;
		const sample = " value a --split-- value b --split--  ";
		const result = splitWithDelimiter(sample, delimiter);
		expect(result).toEqual(["value a", "value b"]);
	});
});

describe("splitWithDelimiterDetailed", () => {
	const delimiter = /^==== \d+/gm;

	test("extracts the index carried by each delimiter", () => {
		const result = splitWithDelimiterDetailed(
			"==== 0\nalpha\n==== 2\nbeta",
			delimiter,
		);
		expect(result).toEqual([
			{ text: "alpha", index: 0 },
			{ text: "beta", index: 2 },
		]);
	});

	test("keeps a leading preamble as unindexed junk", () => {
		const result = splitWithDelimiterDetailed(
			"Some preamble.\n==== 0\nalpha",
			delimiter,
		);
		expect(result).toEqual([
			{ text: "Some preamble.", index: undefined },
			{ text: "alpha", index: 0 },
		]);
	});

	test("string delimiters carry no indices", () => {
		expect(splitWithDelimiterDetailed("a\nb", "\n")).toEqual([
			{ text: "a", index: undefined },
			{ text: "b", index: undefined },
		]);
	});
});

describe("stripOuterFence", () => {
	test("strips a whole-output fence", () => {
		expect(stripOuterFence("```\n==== 0\nalpha\n```")).toBe("==== 0\nalpha");
	});

	test("strips a language-tagged fence and tolerates a missing close", () => {
		expect(stripOuterFence("```markdown\n==== 0\nalpha")).toBe("==== 0\nalpha");
	});

	test("keeps content without an outer fence", () => {
		const value = "==== 0\nalpha ```inline```";
		expect(stripOuterFence(value)).toBe(value);
	});
});

describe("alignSegments", () => {
	const seg = (text: string, index?: number) => ({ text, index });

	test("places segments by delimiter index and reports the gaps", () => {
		const result = alignSegments([seg("a", 0), seg("c", 2), seg("d", 3)], 4);
		expect(result.values).toEqual(["a", undefined, "c", "d"]);
		expect(result.missing).toEqual([1]);
		expect(result.indexed).toBe(true);
	});

	test("ignores leading junk when indices are trustworthy", () => {
		const result = alignSegments([seg("junk"), seg("a", 0), seg("b", 1)], 2);
		expect(result.values).toEqual(["a", "b"]);
		expect(result.missing).toEqual([]);
		expect(result.indexed).toBe(true);
	});

	test("out-of-range indices fall back to positions (renumbered output)", () => {
		const result = alignSegments([seg("a", 1), seg("b", 2)], 2);
		expect(result.values).toEqual(["a", "b"]);
		expect(result.missing).toEqual([]);
		expect(result.indexed).toBe(false);
	});

	test("duplicate indices fall back to positions", () => {
		const result = alignSegments([seg("a", 0), seg("b", 0)], 2);
		expect(result.values).toEqual(["a", "b"]);
		expect(result.indexed).toBe(false);
	});

	test("unindexed junk after indexed segments forces the positional path", () => {
		const result = alignSegments([seg("a", 0), seg("junk"), seg("b", 1)], 2);
		expect(result.values).toEqual([undefined, undefined]);
		expect(result.missing).toEqual([0, 1]);
		expect(result.indexed).toBe(false);
	});

	test("positional count mismatch leaves everything missing", () => {
		const result = alignSegments([seg("a"), seg("b")], 3);
		expect(result.values).toEqual([undefined, undefined, undefined]);
		expect(result.missing).toEqual([0, 1, 2]);
		expect(result.indexed).toBe(false);
	});
});
