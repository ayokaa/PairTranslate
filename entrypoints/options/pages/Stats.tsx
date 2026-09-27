import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { browser } from "#imports";
import { Stats } from "~/components/Stats";
import { SectionHeading } from "~/components/settings/SectionHeading";
import { SectionResetButton } from "~/components/settings/SectionResetButton";
import { SettingsCard } from "~/components/settings/SettingsCard";
import { STORAGE_KEYS } from "~/utils/constants";
import { formatBytes, formatPercent } from "~/utils/format";
import { t } from "~/utils/i18n";
import {
	emptyTranslationStats,
	getTranslationStats,
	resetTranslationStats,
	type TranslationStats,
} from "~/utils/translation-stats";
import { useCacheStats } from "../hooks/useCacheStats";

interface StatMetric {
	label: string;
	desc?: string;
	value: () => string;
}

export default (props: { navId: string }) => {
	const [stats, setStats] = createSignal<TranslationStats>(
		emptyTranslationStats(),
	);
	const { stats: cacheStats, loading: cacheLoading } = useCacheStats();

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
			value: () => stats().chars.toLocaleString(),
		},
		{
			label: t("settings.stats.llmRequests"),
			value: () => stats().llmRequests.toLocaleString(),
		},
		{
			label: t("settings.stats.traditionalRequests"),
			value: () => stats().traditionalRequests.toLocaleString(),
		},
		{
			label: t("settings.stats.cacheHits"),
			desc: t("settings.stats.cacheHitsDesc"),
			value: () => stats().cacheHits.toLocaleString(),
		},
	];

	const tokenMetrics: StatMetric[] = [
		{
			label: t("settings.stats.promptTokens"),
			value: () => stats().promptTokens.toLocaleString(),
		},
		{
			label: t("settings.stats.completionTokens"),
			value: () => stats().completionTokens.toLocaleString(),
		},
		{
			label: t("settings.stats.totalTokens"),
			value: () => stats().totalTokens.toLocaleString(),
		},
		{
			label: t("settings.stats.cachedTokens"),
			value: () => stats().cachedTokens.toLocaleString(),
		},
	];

	const webAdaptationTokenMetrics: StatMetric[] = [
		{
			label: t("settings.stats.promptTokens"),
			value: () => stats().webAdaptationPromptTokens.toLocaleString(),
		},
		{
			label: t("settings.stats.completionTokens"),
			value: () => stats().webAdaptationCompletionTokens.toLocaleString(),
		},
		{
			label: t("settings.stats.totalTokens"),
			value: () => stats().webAdaptationTotalTokens.toLocaleString(),
		},
	];

	// The cache group is a live snapshot rather than an accumulated counter, so
	// it deliberately sits outside the reset button's reach.
	const cacheMetrics: StatMetric[] = [
		{
			label: t("settings.stats.cacheEntries"),
			desc: t("settings.stats.cacheEntriesDesc"),
			value: () => (cacheStats()?.entries ?? 0).toLocaleString(),
		},
		{
			label: t("settings.stats.cacheStorage"),
			desc: t("settings.stats.cacheStorageDesc"),
			value: () => formatBytes(cacheStats()?.bytes ?? 0),
		},
		{
			label: t("settings.stats.cacheCapacity"),
			desc: t("settings.stats.cacheCapacityDesc"),
			value: () => (cacheStats()?.maxSize ?? 0).toLocaleString(),
		},
		{
			label: t("settings.stats.cacheOldest"),
			desc: t("settings.stats.cacheOldestDesc"),
			value: () => {
				const oldest = cacheStats()?.oldestUsedAt ?? 0;
				return oldest > 0 ? new Date(oldest).toLocaleString() : "—";
			},
		},
	];

	const cacheUsageLabel = () => {
		const current = cacheStats();
		if (!current) return "";
		return formatPercent(current.entries, current.maxSize);
	};

	const renderMetric = (metric: StatMetric) => (
		<Stats.Stat centered class="px-4 py-3">
			<Stats.Title class="stat-title text-xs uppercase tracking-wide text-base-content/60">
				{metric.label}
			</Stats.Title>
			<Stats.Value class="text-lg tabular-nums">{metric.value()}</Stats.Value>
			{metric.desc && (
				<Stats.Desc class="text-[11px] text-base-content/60">
					{metric.desc}
				</Stats.Desc>
			)}
		</Stats.Stat>
	);

	const renderStatsRow = (metrics: StatMetric[]) => (
		<Stats.Root
			responsive
			shadow={false}
			class="w-full border border-base-300 bg-base-200/70"
		>
			<For each={metrics}>{renderMetric}</For>
		</Stats.Root>
	);

	const renderGroup = (label: string, metrics: StatMetric[]) => (
		<div>
			<SectionHeading size="sm" class="mb-0">
				{label}
			</SectionHeading>
			{renderStatsRow(metrics)}
		</div>
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
				{renderGroup(t("settings.stats.usageGroup"), generalMetrics)}
				{renderGroup(t("settings.stats.tokenUsage"), tokenMetrics)}
				{renderGroup(
					t("settings.stats.webAdaptationTokenUsage"),
					webAdaptationTokenMetrics,
				)}

				{/* Keyed on the data itself so a background refresh updates the
				    numbers in place instead of collapsing the group. */}
				<Show
					when={cacheStats()}
					fallback={
						<div class="rounded-box border border-base-300 bg-base-200/70 p-4 text-sm text-base-content/60">
							{cacheLoading()
								? t("common.loading")
								: t("settings.stats.cacheUnavailable")}
						</div>
					}
				>
					<div>
						<div class="mb-2 flex items-baseline justify-between gap-2">
							<SectionHeading size="sm" class="mb-0">
								{t("settings.stats.cacheGroup")}
							</SectionHeading>
							<span class="text-[11px] font-medium tabular-nums text-base-content/60">
								{cacheUsageLabel()}
							</span>
						</div>
						{renderStatsRow(cacheMetrics)}
					</div>
				</Show>
			</div>
		</SettingsCard>
	);
};
