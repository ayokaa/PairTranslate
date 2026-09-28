import { describe, expect, test } from "bun:test";
import "../test/dom-setup";
import {
	type AdaptationPatch,
	AdaptationRule,
	appendAdaptationPatch,
	extendPaths,
	findAdaptationRule,
	matchesPath,
	parseAdaptationRules,
	resolvePatchForDocument,
	upsertAdaptationRule,
	validatePatch,
} from "./model";

const patch: AdaptationPatch = {
	roots: ["main.article"],
	excludes: [".article .share"],
	includes: [],
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
		const section = document.createElement("div");
		section.className = "article-section";
		const include = document.createElement("p");
		include.className = "article-text";
		include.textContent = "Recovered article text";
		section.append(include);
		main.append(share, section);
		document.body.append(main);
		expect(
			validatePatch(
				{
					roots: ["main.article", "main.article"],
					excludes: [".share"],
					includes: [
						".article-section",
						".article-section .article-text",
						".article-section",
					],
					promoteTags: [],
				},
				document,
			),
		).toEqual({
			roots: ["main.article"],
			excludes: [".share"],
			includes: [".article-section"],
			promoteTags: [],
		});
		main.remove();
	});

	test("does not allow an include selector to override explicit no-translate", () => {
		const protectedText = document.createElement("p");
		protectedText.className = "notranslate";
		protectedText.textContent = "Do not translate this";
		document.body.append(protectedText);
		expect(
			validatePatch(
				{
					roots: [],
					excludes: [],
					includes: [".notranslate"],
					promoteTags: [],
				},
				document,
			),
		).toBeUndefined();
		protectedText.remove();
	});

	test("rejects conflicting includes and explicit exclusions", () => {
		const excluded = document.createElement("p");
		excluded.className = "review-excluded";
		excluded.textContent = "Excluded text";
		document.body.append(excluded);
		expect(
			validatePatch(
				{
					roots: [],
					excludes: [".review-excluded"],
					includes: [".review-excluded"],
					promoteTags: [],
				},
				document,
			),
		).toBeUndefined();
		excluded.remove();
	});

	test("rejects broad exclusions, hidden roots, and executable selectors", () => {
		const main = document.createElement("main");
		main.className = "private";
		main.setAttribute("hidden", "");
		document.body.append(main);
		expect(
			validatePatch(
				{ roots: [], excludes: ["body"], includes: [], promoteTags: [] },
				document,
			),
		).toBeUndefined();
		expect(
			validatePatch(
				{
					roots: ["main.private"],
					excludes: [],
					includes: [],
					promoteTags: [],
				},
				document,
			),
		).toBeUndefined();
		expect(
			validatePatch(
				{
					roots: ["main:has(script)"],
					excludes: [],
					includes: [],
					promoteTags: [],
				},
				document,
			),
		).toBeUndefined();
		expect(
			validatePatch(
				{ roots: [], excludes: [], includes: [], promoteTags: ["SCRIPT"] },
				document,
			),
		).toBeUndefined();
		main.remove();
	});

	test("retains safe includes and excludes with no current matches", () => {
		const main = document.createElement("main");
		main.className = "runtime-main";
		main.innerHTML = `
			<p class="runtime-content">Visible body text</p>
			<p class="runtime-empty"></p>
			<div class="runtime-noise">Noise</div>
		`;
		document.body.append(main);
		const input = {
			roots: ["main.runtime-main"],
			excludes: [".runtime-noise", ".runtime-late-exclude"],
			includes: [".runtime-empty", ".runtime-removed"],
			promoteTags: [],
		};

		expect(validatePatch(input, document)).toBeUndefined();
		expect(resolvePatchForDocument(input, document)).toEqual({
			roots: ["main.runtime-main"],
			excludes: [".runtime-late-exclude", ".runtime-noise"],
			includes: [".runtime-empty", ".runtime-removed"],
			promoteTags: [],
		});
		main.remove();
	});
});

test("extendPaths never exceeds the schema limit", () => {
	let patterns = ["/docs/getting-started"];
	for (let i = 2; i <= 40; i++) {
		patterns = extendPaths(patterns, `/section-${i}/page`);
	}
	expect(patterns.length).toBeLessThanOrEqual(30);
	const rule = {
		id: "3f2504e0-4f89-11d3-9a0c-0305e82c3300",
		hostname: "example.com",
		pathPatterns: patterns,
		structureKey: "abcd1234",
		enabled: true,
		source: "automatic" as const,
		patch: { roots: ["main"], excludes: [], includes: [], promoteTags: [] },
		createdAt: 1,
		updatedAt: 1,
	};
	expect(AdaptationRule.safeParse(rule).success).toBe(true);
});

test("a stored rule set is sanitized on read", () => {
	expect(parseAdaptationRules(undefined)).toEqual([]);
	expect(parseAdaptationRules([{ hostname: "broken" }])).toEqual([]);
	const valid = {
		id: "3f2504e0-4f89-11d3-9a0c-0305e82c3300",
		hostname: "example.com",
		pathPatterns: ["/a"],
		structureKey: "abcd1234",
		enabled: true,
		source: "manual" as const,
		patch: { roots: [], excludes: [], includes: [], promoteTags: [] },
		createdAt: 1,
		updatedAt: 1,
	};
	expect(parseAdaptationRules([valid])).toEqual([valid]);
});

test("a proposal is appended to the patch in force", () => {
	const existing: AdaptationPatch = {
		roots: ["main.article"],
		excludes: ["nav"],
		includes: [],
		promoteTags: [],
	};

	expect(
		appendAdaptationPatch(existing, {
			roots: [],
			excludes: [],
			includes: ["p.body"],
			promoteTags: [],
		}),
	).toEqual({
		roots: ["main.article"],
		excludes: ["nav"],
		includes: ["p.body"],
		promoteTags: [],
	});
});

test("appending nothing changes nothing", () => {
	const existing: AdaptationPatch = {
		roots: ["main.article"],
		excludes: ["nav"],
		includes: [],
		promoteTags: [],
	};

	expect(
		appendAdaptationPatch(existing, {
			roots: [],
			excludes: [],
			includes: [],
			promoteTags: [],
		}),
	).toEqual(existing);
});

test("appended fields are deduplicated and stay inside the schema", () => {
	const existing: AdaptationPatch = {
		roots: [],
		excludes: ["nav"],
		includes: [],
		promoteTags: [],
	};
	const merged = appendAdaptationPatch(existing, {
		roots: [],
		excludes: [...Array.from({ length: 20 }, (_, i) => `.x${i}`), "nav", "nav"],
		includes: [],
		promoteTags: [],
	});

	expect(merged.excludes).toHaveLength(12);
	expect(merged.excludes).toContain("nav");
	expect(new Set(merged.excludes).size).toBe(merged.excludes.length);
	expect(
		AdaptationRule.safeParse({
			id: "3f2504e0-4f89-11d3-9a0c-0305e82c3300",
			hostname: "example.com",
			pathPatterns: ["/a"],
			structureKey: "abcd1234",
			enabled: true,
			source: "manual",
			patch: merged,
			createdAt: 1,
			updatedAt: 1,
		}).success,
	).toBe(true);
});
