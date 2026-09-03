import { createSignal, For, onCleanup, onMount } from "solid-js";
import { browser } from "#imports";
import { Stats } from "~/components/Stats";
import { SectionResetButton } from "~/components/settings/SectionResetButton";
import { SettingsCard } from "~/components/settings/SettingsCard";
import { STORAGE_KEYS } from "~/utils/constants";
import { t } from "~/utils/i18n";
import {
	emptyTranslationStats,
	getTranslationStats,
	resetTranslationStats,
	type TranslationStats,
} from "~/utils/translation-stats";

interface StatMetric {
	label: string;
	desc?: string;
	value: () => number;
}

export default (props: { navId: string }) => {
	const [stats, setStats] = createSignal<TranslationStats>(
		emptyTranslationStats(),
	);

	onMount(() => {
		void getTranslationStats().then(setStats);

		const listener: Parameters<
			typeof browser.storage.onChanged.addListener
		>[0] = (changes, areaName) => {
			if (areaName !== "local") return;
			const change = changes[STORAGE_KEYS.translationStats];
			if (!change) return;
			setStats({
				...emptyTranslationStats(),
				...(change.newValue as Partial<TranslationStats> | undefined),
			});
		};
		browser.storage.onChanged.addListener(listener);
		onCleanup(() => {
			browser.storage.onChanged.removeListener(listener);
		});
	});

	const generalMetrics: StatMetric[] = [
		{
			label: t("settings.stats.chars"),
			desc: t("settings.stats.charsDesc"),
			value: () => stats().chars,
		},
		{
			label: t("settings.stats.llmRequests"),
			value: () => stats().llmRequests,
		},
		{
			label: t("settings.stats.traditionalRequests"),
			value: () => stats().traditionalRequests,
		},
		{
			label: t("settings.stats.cacheHits"),
			desc: t("settings.stats.cacheHitsDesc"),
			value: () => stats().cacheHits,
		},
	];

	const tokenMetrics: StatMetric[] = [
		{
			label: t("settings.stats.promptTokens"),
			value: () => stats().promptTokens,
		},
		{
			label: t("settings.stats.completionTokens"),
			value: () => stats().completionTokens,
		},
		{
			label: t("settings.stats.totalTokens"),
			value: () => stats().totalTokens,
		},
		{
			label: t("settings.stats.cachedTokens"),
			desc: t("settings.stats.cachedTokensDesc"),
			value: () => stats().cachedTokens,
		},
	];

	const renderMetric = (metric: StatMetric) => (
		<Stats.Stat centered class="px-4 py-3">
			<Stats.Title class="stat-title text-xs uppercase tracking-wide text-base-content/60">
				{metric.label}
			</Stats.Title>
			<Stats.Value class="text-lg">
				{metric.value().toLocaleString()}
			</Stats.Value>
			{metric.desc && (
				<Stats.Desc class="text-[11px] text-base-content/60">
					{metric.desc}
				</Stats.Desc>
			)}
		</Stats.Stat>
	);

	return (
		<SettingsCard
			title={t("settings.stats.title")}
			navId={props.navId}
			actions={
				<SectionResetButton
					confirmMessage={t("settings.stats.resetConfirm")}
					onReset={resetTranslationStats}
				/>
			}
		>
			<p class="text-sm text-base-content/70 mb-4">
				{t("settings.stats.description")}
			</p>
			<div class="space-y-4">
				<Stats.Root
					responsive
					shadow={false}
					class="w-full border border-base-300 bg-base-200/70"
				>
					<For each={generalMetrics}>{renderMetric}</For>
				</Stats.Root>
				<div>
					<p class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-base-content/60">
						{t("settings.stats.tokenUsage")}
					</p>
					<Stats.Root
						responsive
						shadow={false}
						class="w-full border border-base-300 bg-base-200/70"
					>
						<For each={tokenMetrics}>{renderMetric}</For>
					</Stats.Root>
				</div>
			</div>
		</SettingsCard>
	);
};
