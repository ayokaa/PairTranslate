import { beforeEach, expect, mock, test } from "bun:test";
import { STORAGE_KEYS } from "~/utils/constants";
import type { AdaptationRule } from "~/utils/web-adaptation/model";

const stored: Record<string, unknown> = {};
let settings: {
	webAdaptation: { rules: AdaptationRule[] } & Record<string, unknown>;
};

mock.module("#imports", () => ({
	browser: {
		storage: {
			local: {
				get: async (keys: string | string[]) => {
					const names = Array.isArray(keys) ? keys : [keys];
					const result: Record<string, unknown> = {};
					for (const name of names) result[name] = stored[name];
					return result;
				},
				set: async (values: Record<string, unknown>) => {
					Object.assign(stored, values);
				},
			},
		},
	},
}));

mock.module("~/utils/settings/helper", () => ({
	// Keep every export: a partial mock leaks into other test files.
	getSettings: async () => settings,
	saveSettings: async (next: unknown) => {
		settings = next as typeof settings;
	},
	listenSettings: () => () => {},
	listenEnabled: () => () => {},
	getSettingsMigrationError: async () => undefined,
	clearSettingsMigrationError: async () => {},
}));

const { createWebAdaptationService } = await import(
	"../services/web-adaptation"
);

const rule = (overrides: Partial<AdaptationRule> = {}): AdaptationRule => ({
	id: "3f2504e0-4f89-11d3-9a0c-0305e82c3300",
	hostname: "example.com",
	pathPatterns: ["/article"],
	structureKey: "abcd1234",
	enabled: true,
	source: "automatic",
	patch: { roots: ["main"], excludes: [], includes: [], promoteTags: [] },
	createdAt: 1,
	updatedAt: 1,
	...overrides,
});

const proposal = {
	hostname: "example.com",
	pathname: "/article",
	structureKey: "abcd1234",
	source: "manual" as const,
	patch: { roots: ["main"], excludes: [], includes: [], promoteTags: [] },
};

beforeEach(() => {
	for (const key of Object.keys(stored)) delete stored[key];
	settings = { webAdaptation: { autoEnabled: false, rules: [] } };
});

test("a proposal that breaks the patch schema is rejected", async () => {
	const service = createWebAdaptationService();
	settings.webAdaptation = { autoEnabled: false, rules: [] };

	await expect(
		service.commitWebAdaptation({
			...proposal,
			patch: {
				roots: [],
				excludes: Array.from({ length: 13 }, (_, i) => `.x${i}`),
				includes: [],
				promoteTags: [],
			},
		}),
	).rejects.toThrow();
	expect(settings.webAdaptation.rules).toHaveLength(0);
});

test("a valid commit is written back to settings", async () => {
	const service = createWebAdaptationService();
	settings.webAdaptation = { autoEnabled: false, rules: [] };

	expect(await service.commitWebAdaptation(proposal)).toBe("added");
	expect(settings.webAdaptation.rules).toHaveLength(1);
	expect(settings.webAdaptation.rules[0].pathPatterns).toEqual(["/article"]);
});

test("commits are serialized against each other", async () => {
	const service = createWebAdaptationService();
	settings.webAdaptation = { autoEnabled: false, rules: [] };

	const results = await Promise.all([
		service.commitWebAdaptation({ ...proposal, pathname: "/first" }),
		service.commitWebAdaptation({ ...proposal, pathname: "/second" }),
	]);

	expect(results).toEqual(["added", "updated"]);
	expect(settings.webAdaptation.rules).toHaveLength(1);
	expect(settings.webAdaptation.rules[0].pathPatterns).toEqual([
		"/first",
		"/second",
	]);
});

test("the cooldown reserves once and drops the oldest checks", async () => {
	const service = createWebAdaptationService();
	const now = Date.now();
	stored[STORAGE_KEYS.webAdaptationChecks] = Object.fromEntries(
		Array.from({ length: 150 }, (_, i) => [`key${i}`, now - i]),
	);

	expect(await service.reserveWebAdaptationCheck("deadbeef")).toBe(true);
	expect(await service.reserveWebAdaptationCheck("deadbeef")).toBe(false);

	await service.completeWebAdaptationCheck("deadbeef");
	const checks = stored[STORAGE_KEYS.webAdaptationChecks] as Record<
		string,
		number
	>;
	expect(Object.keys(checks)).toHaveLength(150);
	expect(checks.deadbeef).toBeGreaterThan(0);
	// The oldest entry was evicted, so its seven-day cooldown is gone.
	expect(checks.key149).toBeUndefined();
});

test("a released reservation never enters the cooldown", async () => {
	const service = createWebAdaptationService();
	expect(await service.reserveWebAdaptationCheck("cafe1234")).toBe(true);
	await service.releaseWebAdaptationCheck("cafe1234");
	expect(stored[STORAGE_KEYS.webAdaptationChecks]).toBeUndefined();
});

test("a stale rule can be deleted once", async () => {
	const service = createWebAdaptationService();
	settings.webAdaptation = {
		autoEnabled: false,
		rules: [
			rule(),
			rule({
				id: "9f8e7d6c-5b4a-4938-8271-0a1b2c3d4e5f",
				pathPatterns: ["/x"],
			}),
		],
	};

	expect(await service.deleteWebAdaptationRule(rule().id)).toBe(true);
	expect(settings.webAdaptation.rules).toHaveLength(1);
	expect(await service.deleteWebAdaptationRule(rule().id)).toBe(false);
	expect(await service.deleteWebAdaptationRule("")).toBe(false);
});

test("a host cannot accumulate unbounded rules", async () => {
	const service = createWebAdaptationService();
	for (let i = 0; i < 25; i++) {
		await service.commitWebAdaptation({
			...proposal,
			structureKey: ("0000000" + i.toString(16)).slice(-8),
			patch: {
				roots: [`main.${i}`],
				excludes: [],
				includes: [],
				promoteTags: [],
			},
		});
	}

	expect(settings.webAdaptation.rules).toHaveLength(20);
	// The most recent structure survives its own budget, the oldest is dropped.
	expect(
		settings.webAdaptation.rules.some(
			(rule) => rule.structureKey === "00000018",
		),
	).toBe(true);
	expect(
		settings.webAdaptation.rules.some(
			(rule) => rule.structureKey === "00000000",
		),
	).toBe(false);
});
