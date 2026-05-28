import { describe, expect, test } from "bun:test";
import { makeDomainMatcher } from "./domain-matcher";

describe("makeDomainMatcher", () => {
	test("returns null for empty patterns", () => {
		const matcher = makeDomainMatcher([]);
		expect(matcher("example.com")).toBeNull();
	});

	test("matches exact domain", () => {
		const matcher = makeDomainMatcher(["example.com"]);
		expect(matcher("example.com")).toBe(0);
		expect(matcher("other.com")).toBeNull();
	});

	test("matches wildcard subdomain", () => {
		const matcher = makeDomainMatcher(["*.example.com"]);
		expect(matcher("sub.example.com")).toBe(0);
		expect(matcher("deep.sub.example.com")).toBe(0);
		expect(matcher("example.com")).toBeNull();
	});

	test("matches multiple patterns and returns lowest index", () => {
		const matcher = makeDomainMatcher([
			"*.example.com",
			"other.com",
			"sub.example.com",
		]);
		expect(matcher("sub.example.com")).toBe(0);
		expect(matcher("other.com")).toBe(1);
	});

	test("prefers exact match over wildcard when exact has lower index", () => {
		const matcher = makeDomainMatcher(["sub.example.com", "*.example.com"]);
		expect(matcher("sub.example.com")).toBe(0);
	});

	test("returns null when domain does not match any pattern", () => {
		const matcher = makeDomainMatcher(["example.com", "*.test.org"]);
		expect(matcher("unrelated.net")).toBeNull();
		expect(matcher("sub.unrelated.net")).toBeNull();
	});

	test("handles single-label domains", () => {
		const matcher = makeDomainMatcher(["localhost"]);
		expect(matcher("localhost")).toBe(0);
		expect(matcher("other")).toBeNull();
	});
});
