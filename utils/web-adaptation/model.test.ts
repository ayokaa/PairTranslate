import { describe, expect, test } from "bun:test";
import "../test/dom-setup";
import {
	type AdaptationPatch,
	AdaptationRule,
	appendAdaptationPatch,
	extendPaths,
	findAdaptationRule,
	MAX_PATH_PATTERNS,
	MAX_RULES_PER_HOST,
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
			baselineRule: null,
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
				baselineRule: null,
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
				baselineRule: null,
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
			const result = upsertAdaptationRule(
				[existing],
				{ ...proposal, baselineRule: existing },
				2,
			);
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

test("only explicitly removed saved exclusions are subtracted from a patch", () => {
	const existing = { ...patch, excludes: ["nav", ".wrong-exclusion"] };
	expect(
		appendAdaptationPatch(
			existing,
			{
				roots: [],
				excludes: ["footer"],
				includes: [],
				promoteTags: [],
			},
			[".wrong-exclusion"],
		),
	).toEqual({ ...patch, excludes: ["footer", "nav"] });
});

test("a stale proposal cannot overwrite another analysis's recovered paragraph", () => {
	const original = rule("00000000-0000-4000-8000-000000000001", [
		"/blog/first",
	]);
	const saved = { ...original, patch: { ...patch, includes: ["p.recovered"] } };
	const result = upsertAdaptationRule(
		[saved],
		{
			hostname: original.hostname,
			pathname: "/blog/first",
			structureKey: original.structureKey,
			baselineRule: original,
			source: "manual",
			patch: { ...patch, excludes: ["nav"] },
		},
		Date.now(),
	);
	expect(result.result).toBe("stale");
	expect(result.rules).toEqual([saved]);
});

test("a deleted or disabled baseline is never resurrected by a pending trial", () => {
	const original = rule("00000000-0000-4000-8000-000000000001", [
		"/blog/first",
	]);
	const proposal = {
		hostname: original.hostname,
		pathname: "/blog/first",
		structureKey: original.structureKey,
		baselineRule: original,
		source: "manual" as const,
		patch: { ...patch, includes: ["p.recovered"] },
	};
	expect(upsertAdaptationRule([], proposal, Date.now()).result).toBe("stale");
	const disabled = { ...original, enabled: false };
	expect(upsertAdaptationRule([disabled], proposal, Date.now()).rules).toEqual([
		disabled,
	]);
	expect(upsertAdaptationRule([disabled], proposal, Date.now()).result).toBe(
		"stale",
	);
});

test("disabled scopes follow the same specificity as enabled scopes", () => {
	const broad = rule("00000000-0000-4000-8000-000000000001", ["/blog/*"]);
	const exact = rule("00000000-0000-4000-8000-000000000002", ["/blog/first"]);
	expect(
		findAdaptationRule(
			[{ ...broad, enabled: false }, exact],
			"example.com",
			"/blog/first",
			exact.structureKey,
		),
	).toBe(exact);
	expect(
		findAdaptationRule(
			[broad, { ...exact, enabled: false }],
			"example.com",
			"/blog/first",
			exact.structureKey,
		),
	).toBeUndefined();
});

test("automatic proposals cannot override a matching manual wildcard", () => {
	const broad = rule("00000000-0000-4000-8000-000000000001", ["/blog/*"], {
		source: "manual",
	});
	const result = upsertAdaptationRule(
		[broad],
		{
			hostname: broad.hostname,
			pathname: "/blog/first",
			structureKey: broad.structureKey,
			baselineRule: broad,
			source: "automatic",
			patch: { ...patch, includes: ["p.recovered"] },
		},
		Date.now(),
	);
	expect(result.result).toBe("unchanged");
	expect(result.rules).toEqual([broad]);
});

test("legacy rules match only a supplied legacy fingerprint and can update in place", () => {
	const old = rule("00000000-0000-4000-8000-000000000001", ["/blog/first"]);
	const key = "layout:abc12345";
	expect(
		findAdaptationRule([old], old.hostname, "/blog/first", key),
	).toBeUndefined();
	expect(
		findAdaptationRule([old], old.hostname, "/blog/first", key, {
			legacyStructureKey: old.structureKey,
		}),
	).toBe(old);
	const result = upsertAdaptationRule(
		[old],
		{
			hostname: old.hostname,
			pathname: "/blog/first",
			structureKey: key,
			legacyStructureKey: old.structureKey,
			baselineRule: old,
			source: "manual",
			patch: { ...patch, includes: ["p.recovered"] },
		},
		Date.now(),
	);
	expect(result.result).toBe("updated");
	expect(result.rules.map((item) => [item.id, item.structureKey])).toEqual([
		[old.id, key],
	]);
});

test("removing the final exact exclusion restores defaults without an empty rule", () => {
	const old = rule("00000000-0000-4000-8000-000000000001", ["/blog/first"], {
		patch: { roots: [], excludes: ["p.body"], includes: [], promoteTags: [] },
	});
	const result = upsertAdaptationRule(
		[old],
		{
			hostname: old.hostname,
			pathname: "/blog/first",
			structureKey: old.structureKey,
			baselineRule: old,
			source: "manual",
			patch: { roots: [], excludes: [], includes: [], promoteTags: [] },
		},
		Date.now(),
	);
	expect(result.result).toBe("updated");
	expect(result.rules).toEqual([]);
});

test("an empty exact override prevents a broader exclusion from returning", () => {
	const broad = rule("00000000-0000-4000-8000-000000000001", ["/blog/*"]);
	const exact = rule("00000000-0000-4000-8000-000000000002", ["/blog/first"]);
	const empty = { roots: [], excludes: [], includes: [], promoteTags: [] };
	const result = upsertAdaptationRule(
		[broad, exact],
		{
			hostname: exact.hostname,
			pathname: "/blog/first",
			structureKey: exact.structureKey,
			baselineRule: exact,
			source: "manual",
			patch: empty,
		},
		Date.now(),
	);
	expect(
		findAdaptationRule(
			result.rules,
			exact.hostname,
			"/blog/first",
			exact.structureKey,
		)?.patch,
	).toEqual(empty);
	expect(
		findAdaptationRule(
			result.rules,
			exact.hostname,
			"/blog/other",
			exact.structureKey,
		),
	).toBe(broad);
});

test("a full path budget always retains the page just verified", () => {
	const paths = Array.from(
		{ length: MAX_PATH_PATTERNS },
		(_, index) => `/section-${index}/long-article`,
	);
	const existing = rule("00000000-0000-4000-8000-000000000001", paths);
	const pathname = "/a";
	const result = upsertAdaptationRule(
		[existing],
		{
			hostname: existing.hostname,
			pathname,
			structureKey: existing.structureKey,
			baselineRule: null,
			source: existing.source,
			patch,
		},
		Date.now(),
	);
	expect(result.result).toBe("updated");
	expect(result.rules[0].pathPatterns).toHaveLength(MAX_PATH_PATTERNS);
	expect(
		findAdaptationRule(
			result.rules,
			existing.hostname,
			pathname,
			existing.structureKey,
		)?.patch,
	).toEqual(patch);
});

test("merging equivalent patches never turns a manual page into an automatic rule", () => {
	const existing = rule("00000000-0000-4000-8000-000000000001", [
		"/blog/first",
	]);
	const result = upsertAdaptationRule(
		[existing],
		{
			hostname: existing.hostname,
			pathname: "/blog/second",
			structureKey: existing.structureKey,
			baselineRule: null,
			source: "manual",
			patch,
		},
		Date.now(),
	);
	expect(result.result).toBe("added");
	expect(
		findAdaptationRule(
			result.rules,
			existing.hostname,
			"/blog/second",
			existing.structureKey,
		)?.source,
	).toBe("manual");
	expect(
		findAdaptationRule(
			result.rules,
			existing.hostname,
			"/blog/first",
			existing.structureKey,
		),
	).toBe(existing);
});

test("an already-covered equivalent wildcard cannot hide a different active baseline", () => {
	const legacy = rule("00000000-0000-4000-8000-000000000001", ["/blog/*"], {
		updatedAt: Date.now(),
	});
	const newerAlgorithm = rule(
		"00000000-0000-4000-8000-000000000002",
		["/blog/*"],
		{
			structureKey: `layout:${legacy.structureKey}`,
			patch: { ...patch, excludes: ["nav"] },
		},
	);
	const result = upsertAdaptationRule(
		[legacy, newerAlgorithm],
		{
			hostname: legacy.hostname,
			pathname: "/blog/first",
			structureKey: newerAlgorithm.structureKey,
			legacyStructureKey: legacy.structureKey,
			baselineRule: legacy,
			source: legacy.source,
			patch: newerAlgorithm.patch,
		},
		Date.now(),
	);
	expect(result.result).toBe("added");
	expect(
		findAdaptationRule(
			result.rules,
			legacy.hostname,
			"/blog/first",
			newerAlgorithm.structureKey,
			{
				legacyStructureKey: legacy.structureKey,
			},
		)?.patch,
	).toEqual(newerAlgorithm.patch);
});

test("manual analysis of an unchanged wildcard does not add an exact duplicate", () => {
	const broad = rule("00000000-0000-4000-8000-000000000001", ["/blog/*"]);
	const result = upsertAdaptationRule(
		[broad],
		{
			hostname: broad.hostname,
			pathname: "/blog/first",
			structureKey: broad.structureKey,
			baselineRule: broad,
			source: "manual",
			patch: broad.patch,
		},
		Date.now(),
	);
	expect(result.result).toBe("unchanged");
	expect(result.rules).toEqual([broad]);
});

test("a changed manual wildcard trial creates only a page-specific override", () => {
	const broad = rule("00000000-0000-4000-8000-000000000001", ["/blog/*"]);
	const patch = { ...broad.patch, includes: ["p.recovered"] };
	const result = upsertAdaptationRule(
		[broad],
		{
			hostname: broad.hostname,
			pathname: "/blog/first",
			structureKey: broad.structureKey,
			baselineRule: broad,
			source: "manual",
			patch,
		},
		Date.now(),
	);
	expect(result.result).toBe("added");
	expect(result.rules).toHaveLength(2);
	expect(
		findAdaptationRule(
			result.rules,
			broad.hostname,
			"/blog/first",
			broad.structureKey,
		)?.patch,
	).toEqual(patch);
	expect(
		findAdaptationRule(
			result.rules,
			broad.hostname,
			"/blog/other",
			broad.structureKey,
		),
	).toBe(broad);
});

test("the just-verified rule survives a full host budget with future stored timestamps", () => {
	const now = Date.now();
	const existing = Array.from({ length: MAX_RULES_PER_HOST }, (_, index) =>
		rule(crypto.randomUUID(), [`/section-${index}/page`], {
			structureKey: index.toString(16).padStart(8, "0"),
			// A millisecond is the stored timestamp's resolution; one tick is enough
			// to make an imported rule newer than this verified write.
			updatedAt: now + 1,
		}),
	);
	const proposal = {
		hostname: "example.com",
		pathname: "/new",
		structureKey: "ffffffff",
		baselineRule: null,
		source: "automatic" as const,
		patch,
	};
	const result = upsertAdaptationRule(existing, proposal, now);
	expect(result.rules).toHaveLength(MAX_RULES_PER_HOST);
	expect(
		findAdaptationRule(
			result.rules,
			proposal.hostname,
			proposal.pathname,
			proposal.structureKey,
		)?.patch,
	).toEqual(patch);
});
