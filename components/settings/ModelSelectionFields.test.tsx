import { afterEach, expect, mock, test } from "bun:test";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import type { ServicesSettings } from "~/utils/settings/def";
import type { ModelSelectionSettings } from "~/utils/settings/model-selection";

mock.module("~/utils/i18n", () => ({ t: (key: string) => key }));
const { ModelSelectionFields } = await import("./ModelSelectionFields");
const MODEL = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const services: ServicesSettings = {
	provider: {
		type: "llm",
		name: "Test",
		apiSpec: "openai",
		models: {
			[MODEL]: { name: "First", thinkingBudget: "high" },
			[OTHER]: { name: "Second" },
		},
	},
};
const disposers: (() => void)[] = [];
afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
	document.body.replaceChildren();
});

test("renders saved selections and reacts to model and effort changes", () => {
	const [state, setState] = createStore<{ model?: ModelSelectionSettings }>({
		model: { modelId: MODEL, thinkingBudget: "off" },
	});
	const host = document.createElement("div");
	document.body.append(host);
	disposers.push(
		render(
			() => (
				<ModelSelectionFields
					label="Model"
					services={services}
					value={state.model}
					options={[
						{ value: "", label: "None" },
						{ value: MODEL, label: "First" },
						{ value: OTHER, label: "Second" },
					]}
					onChange={(model) => setState("model", model)}
				/>
			),
			host,
		),
	);
	const selects = () => [...host.querySelectorAll("select")];
	expect(selects().map((select) => select.value)).toEqual([MODEL, "off"]);
	setState("model", { modelId: OTHER, thinkingBudget: "high" });
	expect(selects().map((select) => select.value)).toEqual([OTHER, "high"]);
	setState("model", "thinkingBudget", undefined);
	expect(state.model?.thinkingBudget).toBeUndefined();
	setState("model", undefined);
	expect(selects()).toHaveLength(1);
	expect(state.model).toBeUndefined();
});
