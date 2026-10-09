import { expect, mock, test } from "bun:test";
import type { ModelUsage, ModelUsageEntry } from "~/utils/translation-stats";

mock.module("~/utils/i18n", () => ({
	i18n: { t: (key: string) => key },
	t: (key: string) => key,
}));

const { render } = await import("solid-js/web");
const { ModelUsageTable } = await import("./ModelUsageTable");

const usage = (partial: Partial<ModelUsage>): ModelUsage => ({
	label: "",
	requests: 0,
	promptTokens: 0,
	completionTokens: 0,
	totalTokens: 0,
	cachedTokens: 0,
	ttftSamples: 0,
	ttftMs: 0,
	generationMs: 0,
	updatedAt: 0,
	...partial,
});

const renderTable = (models: ModelUsageEntry[]) => {
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <ModelUsageTable models={models} />, host);
	return host;
};

const cellsOf = (host: Element, row: number): string[] =>
	Array.from(host.querySelectorAll("tbody tr")[row].querySelectorAll("td")).map(
		(cell) => cell.textContent?.trim() ?? "",
	);

test("renders measured metrics for a streamed model", () => {
	const host = renderTable([
		{
			id: "model-a",
			usage: usage({
				label: "Service / A",
				requests: 3,
				promptTokens: 1200,
				completionTokens: 400,
				totalTokens: 1600,
				// 400 tokens over 20 s is 20.0 tokens per second.
				generationMs: 20000,
				ttftSamples: 2,
				ttftMs: 900,
			}),
		},
	]);

	expect(cellsOf(host, 0)).toEqual([
		"Service / A",
		(3).toLocaleString(),
		(1200).toLocaleString(),
		(400).toLocaleString(),
		"20.0",
		"450 ms",
	]);
});

test("dashes metrics that have no sample and falls back to the model id", () => {
	const host = renderTable([
		{
			id: "model-b",
			usage: usage({ requests: 1, promptTokens: 10 }),
		},
	]);

	expect(cellsOf(host, 0)).toEqual([
		"model-b",
		(1).toLocaleString(),
		(10).toLocaleString(),
		(0).toLocaleString(),
		"—",
		"—",
	]);
});
