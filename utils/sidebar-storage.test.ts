import { beforeEach, expect, mock, test } from "bun:test";
import { STORAGE_KEYS } from "~/utils/constants";

const store: Record<string, unknown> = {};
mock.module("#imports", () => ({
	browser: {
		storage: {
			local: {
				get: async (key: string) => ({ [key]: store[key] }),
				set: async (values: Record<string, unknown>) =>
					Object.assign(store, values),
			},
		},
	},
}));
const { loadSidebarSettings, saveSidebarSettings } = await import(
	"./sidebar-storage"
);
const MODEL = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
	for (const key of Object.keys(store)) delete store[key];
});

test("loads legacy modelId and saves the new selection with explicit off", async () => {
	store[STORAGE_KEYS.sidebarSettings] = { modelId: MODEL, targetLang: "zh-CN" };
	expect(await loadSidebarSettings()).toEqual({
		model: { modelId: MODEL },
		targetLang: "zh-CN",
	});
	await saveSidebarSettings({
		model: { modelId: MODEL, thinkingBudget: "off" },
		targetLang: "zh-CN",
	});
	expect(await loadSidebarSettings()).toEqual({
		model: { modelId: MODEL, thinkingBudget: "off" },
		targetLang: "zh-CN",
	});
	expect(store[STORAGE_KEYS.sidebarSettings]).not.toHaveProperty("modelId");
});

test("prefers the new model selection and ignores malformed stored values", async () => {
	store[STORAGE_KEYS.sidebarSettings] = {
		modelId: crypto.randomUUID(),
		model: { modelId: MODEL, thinkingBudget: "high" },
		targetLang: 42,
	};
	expect(await loadSidebarSettings()).toEqual({
		model: { modelId: MODEL, thinkingBudget: "high" },
	});
	store[STORAGE_KEYS.sidebarSettings] = {
		model: { modelId: MODEL, thinkingBudget: "invalid" },
	};
	expect(await loadSidebarSettings()).toEqual({});
});
