import { trackStore } from "@solid-primitives/deep";
import { ArrowRight, Plus, Trash2 } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import type z from "zod";
import { Button } from "~/components/Button";
import { ButtonGroup } from "~/components/settings/ButtonGroup";
import { FormGrid } from "~/components/settings/FormGrid";
import {
	OptionSelect,
	type SelectOption,
} from "~/components/settings/OptionSelect";
import { SectionResetButton } from "~/components/settings/SectionResetButton";
import { SettingsCard } from "~/components/settings/SettingsCard";
import { SettingsCheckbox } from "~/components/settings/SettingsCheckbox";
import { SettingsToggle } from "~/components/settings/SettingsToggle";
import { useSettings } from "~/hooks/settings";
import { SUPPORTED_LANGUAGES } from "~/utils/constants";
import { t } from "~/utils/i18n";
import { generateTranslateSettings } from "~/utils/settings";
import * as s from "~/utils/settings/def";
import { selectServicesByType } from "~/utils/settings/services";

export default (props: { navId: string }) => {
	const { settings, setSettings } = useSettings();
	const [localSettings, setLocalSettings] = createStore(settings.translate);

	const [lLMOptions, setLLMOptions] = createSignal<SelectOption[]>([]);
	const [allOptions, setAllOptions] = createSignal<SelectOption[]>([]);

	const [validationErrors, setValidationErrors] =
		createSignal<z.ZodError | null>(null);

	createEffect(
		on(
			() => unwrap(trackStore(localSettings)),
			(current) => {
				const result = s.TranslateSettings.safeParse(current);
				if (!result.success) {
					setValidationErrors(result.error);
				} else {
					setValidationErrors(null);
					setSettings("translate", reconcile(result.data));
				}
			},
			{ defer: true },
		),
	);

	createEffect(() => {
		trackStore(settings.services);
		const services = unwrap(settings.services);
		const llmServices = selectServicesByType(services, "llm");
		const traditionalServices = selectServicesByType(services, "traditional");

		const options: SelectOption[] = [
			{ value: "", label: t("settings.translation.noModel"), disabled: false },
		];
		const lLMOptions = [...options];

		Object.entries(llmServices).forEach(([uuid, service]) => {
			lLMOptions.push({
				value: uuid,
				label: service.name,
				disabled: false,
			});
		});

		const allOptions = [...lLMOptions];

		Object.entries(traditionalServices).forEach(([uuid, service]) => {
			allOptions.push({
				value: uuid,
				label: service.name,
				disabled: false,
			});
		});

		setLLMOptions(lLMOptions);
		setAllOptions(allOptions);
	});

	const getFieldError = (fieldPath: string[]) => {
		if (!validationErrors()) return null;
		return validationErrors()?.issues.find(
			(issue) =>
				issue.path.length === fieldPath.length &&
				issue.path.every((segment, index) => segment === fieldPath[index]),
		);
	};

	const sourceLanguageOptions = createMemo<SelectOption[]>(() => [
		{ value: "auto", label: t("settings.translation.autoDetect") },
		...SUPPORTED_LANGUAGES.map((lang) => ({
			value: lang.code,
			label: lang.nativeName,
		})),
	]);

	const targetLanguageOptions = createMemo<SelectOption[]>(() =>
		SUPPORTED_LANGUAGES.map((lang) => ({
			value: lang.code,
			label: lang.nativeName,
		})),
	);

	const handleReset = () => {
		const defaults = generateTranslateSettings();
		setLocalSettings(reconcile(defaults));
	};

	let exclusionInput: HTMLInputElement | undefined;
	const addExclusion = () => {
		if (!exclusionInput) return;
		const value = exclusionInput.value.trim();
		if (!value) return;
		if (localSettings.summaryExcludedSites.includes(value)) return;
		setLocalSettings("summaryExcludedSites", [
			...localSettings.summaryExcludedSites,
			value,
		]);
		exclusionInput.value = "";
	};
	const removeExclusion = (index: number) => {
		const sites = [...localSettings.summaryExcludedSites];
		sites.splice(index, 1);
		setLocalSettings("summaryExcludedSites", sites);
	};

	return (
		<SettingsCard
			title={t("settings.translation.title")}
			navId={props.navId}
			actions={<SectionResetButton onReset={handleReset} />}
		>
			<FormGrid gap="lg">
				<div class="form-control">
					<label class="label">
						<span class="label-text">
							{t("settings.translation.translationMode")}
						</span>
					</label>
					<ButtonGroup
						options={[
							{
								value: "parallel",
								label: t("settings.translation.modeParallel"),
							},
							{
								value: "replace",
								label: t("settings.translation.modeReplace"),
							},
						]}
						value={localSettings.translationMode}
						onChange={(value) =>
							setLocalSettings(
								"translationMode",
								value as "parallel" | "replace",
							)
						}
						title={t("settings.translation.translationModeDesc")}
					/>
					<br />
					<label class="label">
						<span class="label-text-alt text-xs">
							{t("settings.translation.translationModeDesc")}
						</span>
					</label>
				</div>

				<SettingsCheckbox
					label={t("settings.translation.filterInteractive")}
					helperText={t("settings.translation.filterInteractiveDesc")}
					checked={localSettings.filterInteractive}
					onChange={(e) =>
						setLocalSettings("filterInteractive", e.target.checked)
					}
				/>

				<SettingsCheckbox
					label={t("settings.translation.translateFullPage")}
					helperText={t("settings.translation.translateFullPageDesc")}
					checked={localSettings.translateFullPage}
					onChange={(e) =>
						setLocalSettings("translateFullPage", e.target.checked)
					}
				/>

				<SettingsToggle
					label={t("settings.translation.inTextTranslateIcon")}
					helperText={t("settings.translation.inTextTranslateIconDesc")}
					checked={localSettings.inTextTranslateIconEnabled ?? true}
					onChange={(e) =>
						setLocalSettings("inTextTranslateIconEnabled", e.target.checked)
					}
				/>
			</FormGrid>
			<div class="divider m-0" />
			<FormGrid gap="lg">
				<div class="col-span-full rounded-2xl border border-dashed border-base-300 bg-base-50 p-4">
					<p class="text-xs font-semibold uppercase tracking-wide text-base-content/60">
						{t("settings.translation.sourceLanguage")} →{" "}
						{t("settings.translation.targetLanguage")}
					</p>
					<div class="mt-3 flex flex-wrap items-center gap-3">
						<select
							class="select select-bordered w-full flex-1"
							value={localSettings.sourceLang}
							onChange={(e) =>
								setLocalSettings("sourceLang", e.currentTarget.value)
							}
						>
							{sourceLanguageOptions().map((option) => (
								<option value={option.value} disabled={option.disabled}>
									{option.label}
								</option>
							))}
						</select>
						<div class="rounded-full bg-base-200 p-2">
							<ArrowRight size={16} />
						</div>
						<select
							class="select select-bordered w-full flex-1"
							value={localSettings.targetLang}
							onChange={(e) =>
								setLocalSettings("targetLang", e.currentTarget.value)
							}
						>
							{targetLanguageOptions().map((option) => (
								<option value={option.value} disabled={option.disabled}>
									{option.label}
								</option>
							))}
						</select>
					</div>
				</div>

				<OptionSelect
					label={t("settings.translation.inTextTranslateModel")}
					options={allOptions()}
					value={localSettings.inTextTranslateModel || ""}
					error={getFieldError(["inTextTranslateModel"])?.message}
					onChange={(e) => {
						const value = e.target.value === "" ? undefined : e.target.value;
						setLocalSettings("inTextTranslateModel", value);
					}}
				/>

				<OptionSelect
					label={t("settings.translation.floatingTranslateModel")}
					options={allOptions()}
					value={localSettings.floatingTranslateModel || ""}
					error={getFieldError(["floatingTranslateModel"])?.message}
					onChange={(e) => {
						const value = e.target.value === "" ? undefined : e.target.value;
						setLocalSettings("floatingTranslateModel", value);
					}}
				/>

				<OptionSelect
					label={t("settings.translation.floatingExplainModel")}
					options={lLMOptions()}
					value={localSettings.floatingExplainModel || ""}
					error={getFieldError(["floatingExplainModel"])?.message}
					onChange={(e) => {
						const value = e.target.value === "" ? undefined : e.target.value;
						setLocalSettings("floatingExplainModel", value);
					}}
				/>

				<OptionSelect
					label={t("settings.translation.inputTranslateModel")}
					options={allOptions()}
					value={localSettings.inputTranslateModel || ""}
					error={getFieldError(["inputTranslateModel"])?.message}
					onChange={(e) => {
						const value = e.target.value === "" ? undefined : e.target.value;
						setLocalSettings("inputTranslateModel", value);
					}}
				/>
				<OptionSelect
					label={t("settings.translation.summaryModel")}
					options={lLMOptions()}
					value={localSettings.summaryModel || ""}
					error={getFieldError(["summaryModel"])?.message}
					onChange={(e) => {
						const value = e.target.value === "" ? undefined : e.target.value;
						setLocalSettings("summaryModel", value);
					}}
				/>
				<SettingsCheckbox
					label={t("settings.translation.summaryDefaultPinned")}
					helperText={t("settings.translation.summaryDefaultPinnedDesc")}
					checked={localSettings.summaryDefaultPinned ?? false}
					onChange={(e) =>
						setLocalSettings("summaryDefaultPinned", e.target.checked)
					}
				/>
			</FormGrid>
			<div class="divider m-0" />
			<div class="form-control">
				<label class="label">
					<span class="label-text font-semibold">
						{t("summary.excludedSites")}
					</span>
				</label>
				<p class="text-xs text-base-content/60 mb-2">
					{t("summary.excludedSitesDesc")}
				</p>
				<div class="flex gap-2 mb-2">
					<input
						type="text"
						class="input input-bordered input-sm flex-1"
						placeholder={t("summary.excludedSitesPlaceholder")}
						ref={(el) => {
							exclusionInput = el;
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								addExclusion();
							}
						}}
					/>
					<Button size="sm" variant="primary" on:click={addExclusion}>
						<Plus size={14} />
					</Button>
				</div>
				<For each={localSettings.summaryExcludedSites}>
					{(site, index) => (
						<div class="flex items-center gap-2 py-1">
							<span class="text-sm font-mono flex-1">{site}</span>
							<Button
								size="xs"
								variant="ghost"
								on:click={() => removeExclusion(index())}
							>
								<Trash2 size={14} />
							</Button>
						</div>
					)}
				</For>
			</div>
		</SettingsCard>
	);
};
