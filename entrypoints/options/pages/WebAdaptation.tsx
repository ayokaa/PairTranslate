import { trackDeep } from "@solid-primitives/deep";
import { Globe2, Trash2 } from "lucide-solid";
import { createMemo, For, Show } from "solid-js";
import { Button } from "~/components/Button";
import { Select } from "~/components/Select";
import { SettingsCard } from "~/components/settings/SettingsCard";
import { SettingsToggle } from "~/components/settings/SettingsToggle";
import { useSettings } from "~/hooks/settings";
import { t } from "~/utils/i18n";
import { selectLLMModelOptions } from "~/utils/settings/services";

export default (props: { navId: string }) => {
	const { settings, setSettings } = useSettings();
	const modelOptions = createMemo(() => {
		trackDeep(settings.services);
		return [
			{ value: "", label: t("settings.webAdaptation.noModel") },
			...selectLLMModelOptions(settings.services),
		];
	});

	return (
		<SettingsCard title={t("settings.webAdaptation.title")} navId={props.navId}>
			<p class="text-sm text-base-content/70">
				{t("settings.webAdaptation.description")}
			</p>
			<SettingsToggle
				label={t("settings.webAdaptation.autoEnabled")}
				helperText={t("settings.webAdaptation.autoEnabledDesc")}
				checked={settings.webAdaptation.autoEnabled}
				onChange={(event) =>
					setSettings(
						"webAdaptation",
						"autoEnabled",
						event.currentTarget.checked,
					)
				}
			/>
			<Select
				label={t("settings.webAdaptation.model")}
				helperText={t("settings.webAdaptation.modelDesc")}
				options={modelOptions()}
				value={settings.webAdaptation.modelId ?? ""}
				onChange={(event) =>
					setSettings(
						"webAdaptation",
						"modelId",
						event.currentTarget.value || undefined,
					)
				}
			/>

			<div class="border-t border-base-200 pt-4">
				<h3 class="mb-3 font-semibold">{t("settings.webAdaptation.rules")}</h3>
				<Show
					when={settings.webAdaptation.rules.length > 0}
					fallback={
						<p class="text-sm text-base-content/60">
							{t("settings.webAdaptation.noRules")}
						</p>
					}
				>
					<div class="space-y-3">
						<For each={settings.webAdaptation.rules}>
							{(rule, index) => (
								<div class="rounded-xl border border-base-300 p-4">
									<div class="flex flex-wrap items-start gap-3">
										<Globe2 size={18} class="mt-1 text-base-content/60" />
										<div class="min-w-0 flex-1">
											<p class="break-all font-medium">
												{t("settings.webAdaptation.site")}: {rule.hostname}
											</p>
											<p class="break-all font-mono text-xs text-base-content/60">
												{rule.pathPatterns.join(", ")} · #{rule.structureKey}
											</p>
											<p class="mt-1 text-xs text-base-content/60">
												{t("settings.webAdaptation.source")}:{" "}
												{rule.source === "manual"
													? t("settings.webAdaptation.sourceManual")
													: t("settings.webAdaptation.sourceAutomatic")}{" "}
												· {new Date(rule.updatedAt).toLocaleString()}
											</p>
										</div>
										<SettingsToggle
											aria-label={`${t("settings.webAdaptation.title")}: ${rule.hostname}`}
											checked={rule.enabled}
											onChange={(event) =>
												setSettings(
													"webAdaptation",
													"rules",
													index(),
													"enabled",
													event.currentTarget.checked,
												)
											}
										/>
										<Button
											variant="ghost"
											size="sm"
											aria-label={t("common.delete")}
											onClick={() => {
												if (
													!window.confirm(
														t("settings.webAdaptation.removeConfirm"),
													)
												)
													return;
												setSettings("webAdaptation", "rules", (rules) =>
													rules.filter((item) => item.id !== rule.id),
												);
											}}
										>
											<Trash2 size={16} />
										</Button>
									</div>
									<details class="mt-3 text-xs text-base-content/70">
										<summary class="cursor-pointer">
											{t("settings.webAdaptation.selectors")}
										</summary>
										<div class="mt-2 space-y-1 break-all font-mono">
											<Show when={rule.patch.roots.length > 0}>
												<p>
													{t("settings.webAdaptation.roots")}:{" "}
													{rule.patch.roots.join(", ")}
												</p>
											</Show>
											<Show when={rule.patch.excludes.length > 0}>
												<p>
													{t("settings.webAdaptation.excludes")}:{" "}
													{rule.patch.excludes.join(", ")}
												</p>
											</Show>
											<Show when={rule.patch.promoteTags.length > 0}>
												<p>{rule.patch.promoteTags.join(", ")}</p>
											</Show>
										</div>
									</details>
								</div>
							)}
						</For>
					</div>
				</Show>
			</div>
		</SettingsCard>
	);
};
