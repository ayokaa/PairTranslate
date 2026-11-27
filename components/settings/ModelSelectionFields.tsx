import { createMemo, Show } from "solid-js";
import {
	OptionSelect,
	type SelectOption,
} from "~/components/settings/OptionSelect";
import { t } from "~/utils/i18n";
import {
	THINKING_BUDGET_LEVELS,
	type ThinkingBudget,
} from "~/utils/llm/thinking";
import type { ServicesSettings } from "~/utils/settings/def";
import type { ModelSelectionSettings } from "~/utils/settings/model-selection";
import { resolveLLMModel } from "~/utils/settings/services";

export const thinkingBudgetOptions = (
	modelDefault?: ThinkingBudget,
): SelectOption[] => [
	{
		value: "",
		label: `${t("settings.modelSelection.modelDefault")} (${
			modelDefault
				? t(`settings.llmModal.thinkingBudgetOptions.${modelDefault}`)
				: t("settings.llmModal.thinkingBudgetDefault")
		})`,
	},
	...THINKING_BUDGET_LEVELS.map((level) => ({
		value: level,
		label: t(`settings.llmModal.thinkingBudgetOptions.${level}`),
	})),
];

interface ModelSelectionFieldsProps {
	label: string;
	helperText?: string;
	options: SelectOption[];
	value: ModelSelectionSettings | undefined;
	services: ServicesSettings;
	onChange: (value: ModelSelectionSettings | undefined) => void;
	error?: string;
	thinkingError?: string;
}

export const ModelSelectionFields = (props: ModelSelectionFieldsProps) => {
	const resolvedModel = createMemo(() =>
		resolveLLMModel(props.services, props.value?.modelId),
	);

	return (
		<>
			<OptionSelect
				label={props.label}
				helperText={props.helperText}
				options={props.options}
				value={props.value?.modelId ?? ""}
				error={props.error}
				onChange={(event) => {
					const modelId = event.currentTarget.value;
					props.onChange(
						modelId
							? {
									modelId,
									thinkingBudget: props.value?.thinkingBudget,
								}
							: undefined,
					);
				}}
			/>
			<Show when={resolvedModel()}>
				{(model) => (
					<OptionSelect
						label={t("settings.modelSelection.thinkingBudget")}
						options={thinkingBudgetOptions(model().model.thinkingBudget)}
						value={props.value?.thinkingBudget ?? ""}
						error={props.thinkingError}
						onChange={(event) => {
							const current = props.value;
							if (!current) return;
							const value = event.currentTarget.value;
							props.onChange({
								...current,
								thinkingBudget: value ? (value as ThinkingBudget) : undefined,
							});
						}}
					/>
				)}
			</Show>
		</>
	);
};
