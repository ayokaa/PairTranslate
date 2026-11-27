import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import type { SettingsSchema } from "~/utils/settings";

mock.module("~/utils/i18n", () => ({ t: (key: string) => key }));
// The unrelated modifier selector assigns select.value on mount. linkedom
// lacks that setter; leave its real getter and the model pickers intact.
const selectPrototype = Object.getPrototypeOf(document.createElement("select"));
const valueDescriptor = Object.getOwnPropertyDescriptor(
	selectPrototype,
	"value",
);
if (!valueDescriptor) throw new Error("Expected select.value descriptor");
Object.defineProperty(selectPrototype, "value", {
	...valueDescriptor,
	set: () => {},
});
afterAll(() =>
	Object.defineProperty(selectPrototype, "value", valueDescriptor),
);
const { generateDefaultSettings } = await import("~/utils/settings/default");
const MODEL = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const defaults = generateDefaultSettings();
defaults.services.provider = {
	type: "llm",
	name: "Test",
	apiSpec: "openai",
	models: {
		[MODEL]: { name: "First" },
		[OTHER]: { name: "Second", thinkingBudget: "high" },
	},
};
defaults.translate.inTextTranslateModel = {
	modelId: MODEL,
	thinkingBudget: "off",
};
defaults.translate.floatingTranslateModel = {
	modelId: MODEL,
	thinkingBudget: "low",
};
defaults.summary.summaryModel = { modelId: MODEL, thinkingBudget: "max" };
const [settings, setSettings] = createStore<SettingsSchema>(defaults);
mock.module("~/hooks/settings", () => ({
	useSettings: () => ({ settings, setSettings }),
}));
const { default: Overall } = await import("./Overall");
let dispose: (() => void) | undefined;
afterEach(() => {
	dispose?.();
	document.body.replaceChildren();
});

test("popup model changes preserve each feature's effort and no-model clears the selection", () => {
	Object.assign(globalThis, { window: { document } });
	const host = document.createElement("div");
	document.body.append(host);
	dispose = render(() => <Overall />, host);
	const selects = [...host.querySelectorAll("select")].slice(0, 3);
	const DomEvent = (
		document as unknown as { defaultView: { Event: typeof Event } }
	).defaultView.Event;
	// linkedom's select.value is read-only; provide the user-selected value on
	// each instance while exercising the real popup change handlers.
	const change = (select: HTMLSelectElement, value: string) => {
		Object.defineProperty(select, "value", { configurable: true, value });
		select.dispatchEvent(new DomEvent("change", { bubbles: true }));
	};
	for (const select of selects) change(select, OTHER);
	expect(settings.translate.inTextTranslateModel).toEqual({
		modelId: OTHER,
		thinkingBudget: "off",
	});
	expect(settings.translate.floatingTranslateModel).toEqual({
		modelId: OTHER,
		thinkingBudget: "low",
	});
	expect(settings.summary.summaryModel).toEqual({
		modelId: OTHER,
		thinkingBudget: "max",
	});
	change(selects[0], "");
	expect(settings.translate.inTextTranslateModel).toBeUndefined();
});
