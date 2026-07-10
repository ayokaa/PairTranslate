import { trackStore } from "@solid-primitives/deep";
import { createEffect, createSignal, on } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import type z from "zod";
import { FormGrid } from "~/components/settings/FormGrid";
import { NumberInput } from "~/components/settings/NumberInput";
import {
	OptionSelect,
	type SelectOption,
} from "~/components/settings/OptionSelect";
import { SectionResetButton } from "~/components/settings/SectionResetButton";
import { SettingsCard } from "~/components/settings/SettingsCard";
import { SettingsToggle } from "~/components/settings/SettingsToggle";
import { useSettings } from "~/hooks/settings";
import { t } from "~/utils/i18n";
import { generateSummarySettings } from "~/utils/settings";
import * as s from "~/utils/settings/def";
import { selectServicesByType } from "~/utils/settings/services";

export default (props: { navId: string }) => {
	const { settings, setSettings } = useSettings();
	const [localSettings, setLocalSettings] = createStore(settings.summary);
	const [validationErrors, setValidationErrors] =
		createSignal<z.ZodError | null>(null);

	createEffect(
		on(
			() => unwrap(trackStore(localSettings)),
			(current) => {
				const result = s.SummarySettings.safeParse(current);
				if (!result.success) {
					setValidationErrors(result.error);
				} else {
					setValidationErrors(null);
					setSettings("summary", reconcile(result.data));
				}
			},
			{ defer: true },
		),
	);

	const [lLMOptions, setLLMOptions] = createSignal<SelectOption[]>([]);

	createEffect(() => {
		trackStore(settings.services);
		const services = unwrap(settings.services);
		const llmServices = selectServicesByType(services, "llm");

		const options: SelectOption[] = [
			{ value: "", label: t("settings.translation.noModel"), disabled: false },
		];

		Object.entries(llmServices).forEach(([uuid, service]) => {
			options.push({ value: uuid, label: service.name, disabled: false });
		});

		setLLMOptions(options);
	});

	const getFieldError = (fieldPath: string[]) => {
		if (!validationErrors()) return null;
		return validationErrors()?.issues.find(
			(issue) =>
				issue.path.length === fieldPath.length &&
				issue.path.every((segment, index) => segment === fieldPath[index]),
		);
	};

	const handleReset = () => {
		const defaults = generateSummarySettings();
		setLocalSettings(reconcile(defaults));
	};

	return (
		<SettingsCard
			title={t("settings.summary.title")}
			navId={props.navId}
			actions={<SectionResetButton onReset={handleReset} />}
		>
			<FormGrid gap="lg">
				<OptionSelect
					label={t("settings.summary.summaryModel")}
					helperText={t("settings.summary.summaryModelDesc")}
					options={lLMOptions()}
					value={localSettings.summaryModel || ""}
					error={getFieldError(["summaryModel"])?.message}
					onChange={(e) => {
						const value = e.target.value === "" ? undefined : e.target.value;
						setLocalSettings("summaryModel", value);
					}}
				/>
				<SettingsToggle
					label={t("settings.summary.summaryDefaultPinned")}
					helperText={t("settings.summary.summaryDefaultPinnedDesc")}
					checked={localSettings.summaryDefaultPinned ?? false}
					onChange={(e) =>
						setLocalSettings("summaryDefaultPinned", e.target.checked)
					}
				/>
				<NumberInput
					label={t("settings.summary.summaryGeometryMaxEntries")}
					helperText={t("settings.summary.summaryGeometryMaxEntriesDesc")}
					value={localSettings.summaryGeometryMaxEntries ?? 1000}
					min={1}
					onChange={(e) =>
						setLocalSettings(
							"summaryGeometryMaxEntries",
							Number(e.target.value),
						)
					}
				/>
			</FormGrid>
		</SettingsCard>
	);
};
