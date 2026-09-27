import { trackStore } from "@solid-primitives/deep";
import { Box, Highlighter, TextAlignStart } from "lucide-solid";
import { createMemo, For } from "solid-js";
import { reconcile, unwrap } from "solid-js/store";
import { Card } from "~/components/Card";
import { ButtonGroup } from "~/components/settings/ButtonGroup";
import { TranslationStyleControls } from "~/components/settings/TranslationStyleControls";
import { useSettings } from "~/hooks/settings";
import { t } from "~/utils/i18n";
import {
	getDefaultModifierKey,
	getModifierOptions,
	type SelectionTranslateModifier,
} from "~/utils/modifier";
import {
	selectLLMModelOptions,
	selectServicesByType,
} from "~/utils/settings/services";

export default () => {
	const { settings, setSettings } = useSettings();

	const modelList = createMemo(() => {
		trackStore(settings.services);
		const services = unwrap(settings.services);
		const traditionalServices = selectServicesByType(services, "traditional");

		const options = [
			{ value: "", label: t("settings.translation.noModel"), disabled: false },
		];
		for (const option of selectLLMModelOptions(services)) {
			options.push({ ...option, disabled: false });
		}
		Object.entries(traditionalServices).forEach(([uuid, service]) => {
			options.push({
				value: uuid,
				label: service.name,
				disabled: false,
			});
		});
		return options;
	});

	const llmModelList = createMemo(() => {
		trackStore(settings.services);
		const services = unwrap(settings.services);

		const options = [
			{ value: "", label: t("settings.translation.noModel"), disabled: false },
		];
		for (const option of selectLLMModelOptions(services)) {
			options.push({ ...option, disabled: false });
		}

		return options;
	});
	const modifierOptions = getModifierOptions();
	const selectionModifier = () =>
		settings.basic.selectionTranslateModifier ?? getDefaultModifierKey();

	return (
		<div class="flex flex-col gap-3">
			<Card.Root class="w-full rounded-box border border-base-200">
				<Card.Body class="gap-3 p-4">
					<Card.Title class="text-sm">
						<Box size={16} />
						{t("settings.translation.modelSettings")}
					</Card.Title>
					<div class="flex flex-col gap-3">
						<label class="flex flex-col gap-1">
							<span class="text-xs text-base-content/70">
								{t("settings.translation.inTextTranslateModel")}
							</span>
							<select
								class="select select-sm w-full"
								on:change={(e) => {
									setSettings(
										"translate",
										"inTextTranslateModel",
										e.target.value || undefined,
									);
								}}
							>
								<option disabled>
									{t("settings.translation.inTextTranslateModel")}
								</option>
								<For each={modelList()}>
									{(option) => (
										<option
											value={option.value}
											selected={
												option.value === settings.translate.inTextTranslateModel
											}
										>
											{option.label}
										</option>
									)}
								</For>
							</select>
						</label>
						<label class="flex flex-col gap-1">
							<span class="text-xs text-base-content/70">
								{t("settings.translation.floatingTranslateModel")}
							</span>
							<select
								class="select select-sm w-full"
								on:change={(e) =>
									setSettings(
										"translate",
										"floatingTranslateModel",
										e.target.value || undefined,
									)
								}
							>
								<option disabled>
									{t("settings.translation.floatingTranslateModel")}
								</option>
								<For each={modelList()}>
									{(option) => (
										<option
											value={option.value}
											selected={
												option.value ===
												settings.translate.floatingTranslateModel
											}
										>
											{option.label}
										</option>
									)}
								</For>
							</select>
						</label>
						<label class="flex flex-col gap-1">
							<span class="text-xs text-base-content/70">
								{t("settings.summary.summaryModel")}
							</span>
							<select
								class="select select-sm w-full"
								on:change={(e) =>
									setSettings(
										"summary",
										"summaryModel",
										e.target.value || undefined,
									)
								}
							>
								<option disabled>{t("settings.summary.summaryModel")}</option>
								<For each={llmModelList()}>
									{(option) => (
										<option
											value={option.value}
											selected={option.value === settings.summary.summaryModel}
										>
											{option.label}
										</option>
									)}
								</For>
							</select>
						</label>
					</div>
				</Card.Body>
			</Card.Root>
			<Card.Root class="w-full rounded-box border border-base-200">
				<Card.Body class="gap-3 p-4">
					<Card.Title class="text-sm">
						<TextAlignStart size={16} />
						{t("settings.translation.translationSettings")}
					</Card.Title>
					<div class="flex flex-col gap-3">
						<div class="flex flex-col gap-1">
							<span class="text-xs text-base-content/70">
								{t("settings.translation.translateFullPage")}
							</span>
							<ButtonGroup
								stretch
								class="w-full"
								options={[
									{
										value: "full",
										label: t("settings.translation.fullPage"),
									},
									{
										value: "visible",
										label: t("settings.translation.visible"),
									},
								]}
								value={
									settings.translate.translateFullPage ? "full" : "visible"
								}
								onChange={(value) =>
									setSettings(
										"translate",
										"translateFullPage",
										value === "full",
									)
								}
							/>
						</div>
						<div class="flex flex-col gap-1">
							<span class="text-xs text-base-content/70">
								{t("settings.translation.displayMode")}
							</span>
							<ButtonGroup
								stretch
								class="w-full"
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
								value={settings.translate.translationMode}
								onChange={(value) =>
									setSettings(
										"translate",
										"translationMode",
										value as "parallel" | "replace",
									)
								}
							/>
						</div>
						<div class="flex flex-col gap-1">
							<div class="flex items-center gap-2">
								<span class="text-xs text-base-content/70">
									{t("settings.basic.selectionTranslateEnabled")}
								</span>
								<div class="flex-1" />
								<input
									type="checkbox"
									checked={settings.basic.selectionTranslateEnabled}
									class="toggle toggle-sm shrink-0"
									onChange={(e) =>
										setSettings(
											"basic",
											"selectionTranslateEnabled",
											e.target.checked,
										)
									}
								/>
							</div>
							<div class="flex items-center gap-2">
								<select
									class="select select-xs max-w-24 shrink-0"
									disabled={!settings.basic.selectionTranslateEnabled}
									value={selectionModifier()}
									on:change={(e) =>
										setSettings(
											"basic",
											"selectionTranslateModifier",
											e.target.value as SelectionTranslateModifier,
										)
									}
								>
									<For each={modifierOptions}>
										{(option) => (
											<option value={option.value}>{option.label}</option>
										)}
									</For>
								</select>
								<span class="min-w-0 flex-1 text-xs text-base-content/60">
									{t("settings.translation.selectionTranslateHintSuffix")}
								</span>
							</div>
						</div>
					</div>
				</Card.Body>
			</Card.Root>
			<Card.Root class="w-full rounded-box border border-base-200">
				<Card.Body class="flex flex-col gap-3 p-4">
					<Card.Title class="text-sm">
						<Highlighter size={16} />
						{t("settings.translation.styleTitle")}
					</Card.Title>
					<div class="flex flex-col gap-1">
						<TranslationStyleControls
							value={settings.basic.translationStyle}
							onChange={(style) => {
								if (!style) return;
								setSettings("basic", "translationStyle", reconcile(style));
							}}
						/>
						<p class="text-[0.65rem] text-base-content/60">
							{t("settings.translation.styleBackgroundDesc")}
						</p>
					</div>
					<div class="flex flex-col gap-1">
						<div class="flex items-center gap-2">
							<span class="text-xs font-semibold">
								{t("settings.translation.inTextTranslateIcon")}
							</span>
							<div class="flex-1" />
							<input
								type="checkbox"
								class="toggle toggle-sm"
								checked={settings.translate.inTextTranslateIconEnabled ?? true}
								onChange={(e) =>
									setSettings(
										"translate",
										"inTextTranslateIconEnabled",
										e.target.checked,
									)
								}
							/>
						</div>
						<p class="text-[0.65rem] text-base-content/60">
							{t("settings.translation.inTextTranslateIconDesc")}
						</p>
					</div>
				</Card.Body>
			</Card.Root>
		</div>
	);
};
