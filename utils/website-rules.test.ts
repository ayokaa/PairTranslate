import { describe, expect, test } from "bun:test";
import type { WebsiteRulesSettings } from "./settings/def";
import { findWebsiteRuleIndex } from "./website-rules";

const rules = (patterns: string[][]): WebsiteRulesSettings =>
	patterns.map((urlPatterns) => ({ urlPatterns }));

describe("findWebsiteRuleIndex", () => {
	test("returns null when there are no rules", () => {
		expect(findWebsiteRuleIndex([], "example.com")).toBeNull();
	});

	test("returns null for an empty domain", () => {
		expect(findWebsiteRuleIndex(rules([["example.com"]]), "")).toBeNull();
	});

	test("maps a matched domain back to its parent rule index", () => {
		const websiteRules = rules([
			["one.example", "first.example"],
			["two.example"],
			["three.example", "last.example"],
		]);
		expect(findWebsiteRuleIndex(websiteRules, "first.example")).toBe(0);
		expect(findWebsiteRuleIndex(websiteRules, "two.example")).toBe(1);
		expect(findWebsiteRuleIndex(websiteRules, "last.example")).toBe(2);
	});

	test("resolves against local rules without any async lookup", () => {
		// The bug this guards: after a rule is added the value must be available
		// synchronously, on the same tick, instead of a tick (or click) later once
		// a background matcher catches up.
		const before = findWebsiteRuleIndex([], "example.com");
		expect(before).toBeNull();

		const after = findWebsiteRuleIndex(rules([["example.com"]]), "example.com");
		expect(after).toBe(0);
	});

	test("returns the lowest matching rule index across multiple rules", () => {
		const websiteRules = rules([["*.example.com"], ["sub.example.com"]]);
		// "*.example.com" is pattern index 0 and also matches, so rule 0 wins.
		expect(findWebsiteRuleIndex(websiteRules, "sub.example.com")).toBe(0);
	});

	test("returns null when the domain matches no rule", () => {
		const websiteRules = rules([["example.com"], ["*.test.org"]]);
		expect(findWebsiteRuleIndex(websiteRules, "unrelated.net")).toBeNull();
	});
});
