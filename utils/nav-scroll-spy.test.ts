import { describe, expect, test } from "bun:test";
import { pickActiveNavSection } from "./nav-scroll-spy";

describe("pickActiveNavSection", () => {
	test("returns the topmost intersecting section in DOM order", () => {
		expect(
			pickActiveNavSection(new Set(["translate", "basic", "llm"]), [
				"basic",
				"translate",
				"llm",
			]),
		).toBe("basic");
	});

	test("skips non-intersecting sections to find the next one", () => {
		expect(
			pickActiveNavSection(new Set(["llm"]), ["basic", "translate", "llm"]),
		).toBe("llm");
	});

	test("returns null when nothing is intersecting", () => {
		expect(
			pickActiveNavSection(new Set(), ["basic", "translate", "llm"]),
		).toBeNull();
	});

	test("ignores ids that exist in the set but not in DOM order", () => {
		expect(
			pickActiveNavSection(new Set(["unknown", "translate"]), [
				"basic",
				"translate",
				"llm",
			]),
		).toBe("translate");
	});

	test("handles a single intersecting section", () => {
		expect(pickActiveNavSection(new Set(["basic"]), ["basic"])).toBe("basic");
	});
});
