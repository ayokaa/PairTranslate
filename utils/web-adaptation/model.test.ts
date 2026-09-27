import { describe, expect, test } from "bun:test";
import "../test/dom-setup";
import {
	type AdaptationPatch,
	type AdaptationRule,
	extendPaths,
	findAdaptationRule,
	matchesPath,
	upsertAdaptationRule,
	validatePatch,
} from "./model";

const patch: AdaptationPatch = {
	roots: ["main.article"],
	excludes: [".article .share"],
	promoteTags: [],
};

function rule(
	id: string,
	paths: string[],
	options: Partial<AdaptationRule> = {},
): AdaptationRule {
	return {
		id,
		hostname: "example.com",
		pathPatterns: paths,
		structureKey: "abc12345",
		enabled: true,
		source: "automatic",
		patch,
		createdAt: 1,
		updatedAt: 1,
		...options,
	};
}

describe("web adaptation scope", () => {
	test("a sibling wildcard covers only one path segment", () => {
		expect(matchesPath("/blog/*", "/blog/first")).toBe(true);
		expect(matchesPath("/blog/*", "/blog/first/comments")).toBe(false);
		expect(matchesPath("/blog/*", "/blog")).toBe(false);
		expect(extendPaths(["/blog/first"], "/blog/second")).toEqual(["/blog/*"]);
	});

	test("a wildcard requires the same structure, while an exact path wins", () => {
		const broad = rule("00000000-0000-4000-8000-000000000001", ["/blog/*"]);
		const exact = rule(
			"00000000-0000-4000-8000-000000000002",
			["/blog/first"],
			{
				structureKey: "fedcba98",
				patch: { ...patch, roots: ["main.other"] },
			},
		);
		expect(
			findAdaptationRule([broad], "example.com", "/blog/first", "fedcba98"),
		).toBeUndefined();
		expect(
			findAdaptationRule(
				[broad, exact],
				"example.com",
				"/blog/first",
				"fedcba98",
			),
		).toBe(exact);
	});

	test("an equivalent second page extends one rule, then deduplicates", () => {
		const first = rule("00000000-0000-4000-8000-000000000001", ["/blog/first"]);
		const proposal = {
			hostname: "example.com",
			pathname: "/blog/second",
			structureKey: "abc12345",
			source: "automatic" as const,
			patch,
		};
		const second = upsertAdaptationRule([first], proposal, 2);
		expect(second.result).toBe("updated");
		expect(second.rules).toHaveLength(1);
		expect(second.rules[0].pathPatterns).toEqual(["/blog/*"]);
		const duplicate = upsertAdaptationRule(second.rules, proposal, 3);
		expect(duplicate.result).toBe("unchanged");
		expect(duplicate.rules).toHaveLength(1);
	});

	test("a different structure does not overwrite a sibling wildcard", () => {
		const broad = rule("00000000-0000-4000-8000-000000000001", ["/blog/*"]);
		const result = upsertAdaptationRule(
			[broad],
			{
				hostname: "example.com",
				pathname: "/blog/second",
				structureKey: "fedcba98",
				source: "automatic",
				patch: { ...patch, roots: ["main.other"] },
			},
			2,
		);
		expect(result.result).toBe("added");
		expect(result.rules).toHaveLength(2);
		expect(result.rules[0]).toBe(broad);
		expect(result.rules[1].pathPatterns).toEqual(["/blog/second"]);
	});

	test("a new structure on the same path keeps the old template", () => {
		const old = rule("00000000-0000-4000-8000-000000000001", ["/blog/first"]);
		const result = upsertAdaptationRule(
			[old],
			{
				hostname: "example.com",
				pathname: "/blog/first",
				structureKey: "fedcba98",
				source: "automatic",
				patch: { ...patch, roots: ["main.other"] },
			},
			2,
		);
		expect(result.result).toBe("added");
		expect(result.rules).toHaveLength(2);
		expect(result.rules[0]).toBe(old);
	});

	test("automatic analysis leaves manual and disabled rules alone", () => {
		const proposal = {
			hostname: "example.com",
			pathname: "/blog/first",
			structureKey: "abc12345",
			source: "automatic" as const,
			patch: { ...patch, roots: ["main.other"] },
		};
		for (const options of [{ source: "manual" as const }, { enabled: false }]) {
			const existing = rule(
				"00000000-0000-4000-8000-000000000001",
				["/blog/first"],
				options,
			);
			const result = upsertAdaptationRule([existing], proposal, 2);
			expect(result.result).toBe("unchanged");
			expect(result.rules).toEqual([existing]);
		}
	});
});

describe("web adaptation validation", () => {
	test("accepts a present, bounded selector and normalizes duplicates", () => {
		const main = document.createElement("main");
		main.className = "article";
		const share = document.createElement("div");
		share.className = "share";
		main.append(share);
		document.body.append(main);
		expect(
			validatePatch(
				{
					roots: ["main.article", "main.article"],
					excludes: [".share"],
					promoteTags: [],
				},
				document,
			),
		).toEqual({
			roots: ["main.article"],
			excludes: [".share"],
			promoteTags: [],
		});
		main.remove();
	});

	test("rejects broad exclusions, hidden roots, and executable selectors", () => {
		const main = document.createElement("main");
		main.className = "private";
		main.setAttribute("hidden", "");
		document.body.append(main);
		expect(
			validatePatch(
				{ roots: [], excludes: ["body"], promoteTags: [] },
				document,
			),
		).toBeUndefined();
		expect(
			validatePatch(
				{ roots: ["main.private"], excludes: [], promoteTags: [] },
				document,
			),
		).toBeUndefined();
		expect(
			validatePatch(
				{ roots: ["main:has(script)"], excludes: [], promoteTags: [] },
				document,
			),
		).toBeUndefined();
		expect(
			validatePatch(
				{ roots: [], excludes: [], promoteTags: ["SCRIPT"] },
				document,
			),
		).toBeUndefined();
		main.remove();
	});
});
