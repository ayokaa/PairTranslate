import { expect, mock, test } from "bun:test";
import type {
	ModelRequestSample,
	ModelUsage,
	ModelUsageEntry,
} from "~/utils/translation-stats";

// Include the substitution arguments, so the cell tooltips can be asserted.
const translate = (key: string, args?: string[]) =>
	args ? `${key}(${args.join(",")})` : key;

mock.module("~/utils/i18n", () => ({ i18n: { t: translate }, t: translate }));

const { render } = await import("solid-js/web");
const { ModelUsageTable } = await import("./ModelUsageTable");

const usage = (partial: Partial<ModelUsage>): ModelUsage => ({
	label: "",
	requests: 0,
	promptTokens: 0,
	completionTokens: 0,
	totalTokens: 0,
	cachedTokens: 0,
	recent: [],
	updatedAt: 0,
	...partial,
});

const sample = (partial: Partial<ModelRequestSample>): ModelRequestSample => ({
	completionTokens: 0,
	generationMs: 0,
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

const tilesOf = (host: Element, row: number): (string | null)[] =>
	Array.from(host.querySelectorAll("tbody tr")[row].querySelectorAll("td")).map(
		(cell) => cell.getAttribute("title"),
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
				recent: [
					sample({ completionTokens: 300, generationMs: 15000, ttftMs: 500 }),
					sample({ completionTokens: 100, generationMs: 5000, ttftMs: 400 }),
				],
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
	expect(tilesOf(host, 0)).toEqual([
		null,
		null,
		null,
		null,
		"settings.stats.modelWindowSamples(2)",
		"settings.stats.modelWindowSamples(2)",
	]);
	// A long label is truncated, so its full text lives in a tooltip.
	expect(host.querySelector("tbody tr td div")?.getAttribute("title")).toBe(
		"Service / A",
	);
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
	expect(tilesOf(host, 0).slice(4)).toEqual([null, null]);
});

test("counts unary requests towards throughput but not first-token latency", () => {
	const host = renderTable([
		{
			id: "model-c",
			usage: usage({
				requests: 2,
				recent: [
					sample({ completionTokens: 50, generationMs: 1000 }),
					sample({ completionTokens: 50, generationMs: 1000, ttftMs: 200 }),
				],
			}),
		},
	]);

	expect(cellsOf(host, 0).slice(4)).toEqual(["50.0", "200 ms"]);
	expect(tilesOf(host, 0).slice(4)).toEqual([
		"settings.stats.modelWindowSamples(2)",
		"settings.stats.modelWindowSamples(1)",
	]);
});
