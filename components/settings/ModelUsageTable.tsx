import { type Component, For } from "solid-js";
import { formatLatency, formatRate } from "~/utils/format";
import { t } from "~/utils/i18n";
import {
	type ModelUsageEntry,
	modelFirstTokenLatency,
	modelTokensPerSecond,
} from "~/utils/translation-stats";

const DASH = "—";

const formatOptionalRate = (value: number | null): string =>
	value === null ? DASH : formatRate(value);

const formatOptionalLatency = (value: number | null): string =>
	value === null ? DASH : formatLatency(value);

/**
 * Per-model performance table for the statistics page.
 *
 * Rows arrive already ordered (most recently used first) and the component
 * only formats them, so ordering stays testable outside the view layer.
 *
 * A dash stands for a metric that has no sample yet: first-token latency only
 * exists for streaming requests, and TPS needs provider-reported output tokens.
 */
export const ModelUsageTable: Component<{ models: ModelUsageEntry[] }> = (
	props,
) => {
	const cellClass = "text-right tabular-nums";

	return (
		<div class="overflow-x-auto rounded-box border border-base-300 bg-base-200/70">
			<table class="table w-full text-sm">
				<thead>
					<tr class="text-xs uppercase tracking-wide text-base-content/60">
						<th class="font-medium">{t("settings.stats.modelColumn")}</th>
						<th class={`w-24 font-medium ${cellClass}`}>
							{t("settings.stats.modelRequests")}
						</th>
						<th class={`w-28 font-medium ${cellClass}`}>
							{t("settings.stats.promptTokens")}
						</th>
						<th class={`w-28 font-medium ${cellClass}`}>
							{t("settings.stats.completionTokens")}
						</th>
						<th class={`w-24 font-medium ${cellClass}`}>
							{t("settings.stats.modelTps")}
						</th>
						<th class={`w-28 font-medium ${cellClass}`}>
							{t("settings.stats.modelTtft")}
						</th>
					</tr>
				</thead>
				<tbody>
					<For each={props.models}>
						{(entry) => {
							const tps = () => modelTokensPerSecond(entry.usage);
							const ttft = () => modelFirstTokenLatency(entry.usage);
							return (
								<tr>
									<td>
										<div
											class="max-w-[18rem] truncate font-medium text-base-content"
											title={entry.usage.label}
										>
											{entry.usage.label || entry.id}
										</div>
									</td>
									<td class={cellClass}>
										{entry.usage.requests.toLocaleString()}
									</td>
									<td class={cellClass}>
										{entry.usage.promptTokens.toLocaleString()}
									</td>
									<td class={cellClass}>
										{entry.usage.completionTokens.toLocaleString()}
									</td>
									<td class={cellClass}>{formatOptionalRate(tps())}</td>
									<td class={cellClass}>{formatOptionalLatency(ttft())}</td>
								</tr>
							);
						}}
					</For>
				</tbody>
			</table>
		</div>
	);
};
