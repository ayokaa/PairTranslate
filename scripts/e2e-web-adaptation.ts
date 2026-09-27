import "../utils/test/dom-setup";
import { mock } from "bun:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseHTML } from "linkedom";
import { recordTranslationObservation } from "../entrypoints/content/web-adaptation/observations";
import { buildPageSnapshot } from "../entrypoints/content/web-adaptation/snapshot";
import { PROMPT_ID } from "../utils/constants";
import { makeDomainMatcher } from "../utils/domain-matcher";
import { autoStripMarkdown } from "../utils/json-autocomplete";
import { createOpenAIClient } from "../utils/llm/openai";
import { LLMError } from "../utils/llm/types";
import { getMarkdownFromSection } from "../utils/markdown";
import {
	PARSER_LIST,
	PARSER_PATTERNS,
	PATTERNS_IDX_TO_PARSER_IDX,
} from "../utils/parser";
import { domListener } from "../utils/parser/base";
import type { DOMSection } from "../utils/parser/types";
import {
	buildContextWithTranslateParams,
	templateToTokens,
	tokensToString,
} from "../utils/prompt/parser";
import { applyAdaptationPatch } from "../utils/web-adaptation/apply";
import {
	AdaptationProposalSchema,
	type AdaptationRule,
	AdaptationSuggestion,
	findAdaptationRule,
	upsertAdaptationRule,
} from "../utils/web-adaptation/model";

type Sample = { section: DOMSection; text: string; element: Element };
type Stage =
	| "configuration"
	| "curl"
	| "extraction"
	| "translation"
	| "snapshot"
	| "runtime"
	| "result";

const fixtureUrl = new URL(
	"./fixtures/web-adaptation-static.html",
	import.meta.url,
);
const configUrl = new URL("../.env.e2e.local", import.meta.url);
const dryRun = process.argv.includes("--dry-run");
const inspect = process.argv.includes("--inspect");
const showPatch = process.argv.includes("--show-patch");
const urlIndex = process.argv.indexOf("--url");
const requestedUrl = urlIndex >= 0 ? process.argv[urlIndex + 1] : undefined;
const fileIndex = process.argv.indexOf("--html-file");
const htmlFile = fileIndex >= 0 ? process.argv[fileIndex + 1] : undefined;
const expectationIndex = process.argv.indexOf("--expect");
const expectation =
	expectationIndex >= 0 ? process.argv[expectationIndex + 1] : undefined;
const matchParser = makeDomainMatcher(PARSER_PATTERNS);
let stage: Stage = "configuration";

function fail(message: string): never {
	throw new Error(`${stage}: ${message}`);
}

async function readConfig(): Promise<Record<string, string>> {
	const values: Record<string, string> = {};
	if (await Bun.file(configUrl).exists()) {
		for (const line of (await Bun.file(configUrl).text()).split(/\r?\n/)) {
			const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/);
			if (!match) continue;
			let value = match[2].trim();
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			values[match[1]] = value;
		}
	}
	for (const name of [
		"PAIRTRANSLATE_E2E_API_KEY",
		"PAIRTRANSLATE_E2E_BASE_URL",
		"PAIRTRANSLATE_E2E_MODEL",
	]) {
		if (process.env[name]) values[name] = process.env[name];
	}
	return values;
}

async function curlHtml(target: string): Promise<string> {
	const proc = Bun.spawn(
		[
			"curl",
			"--fail",
			"--location",
			"--silent",
			"--show-error",
			"--max-time",
			"30",
			"--max-filesize",
			"3000000",
			target,
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const [html, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) fail(`curl failed (${code}; ${stderr.length} stderr bytes)`);
	if (!html.trim()) fail("curl returned an empty page");
	return html;
}

async function collectSamples(
	patch?: Parameters<typeof applyAdaptationPatch>[1],
) {
	const options = applyAdaptationPatch(
		{ roots: [document.body], listenNew: false, filterInteractive: true },
		patch,
		document,
	);
	const result: Sample[] = [];
	const patternIndex = matchParser(window.location.hostname);
	const parserIndex =
		patternIndex === null ? null : PATTERNS_IDX_TO_PARSER_IDX[patternIndex];
	const listener =
		parserIndex === null ? domListener : PARSER_LIST[parserIndex].domListener;
	for await (const section of listener(options)) {
		const text = getMarkdownFromSection(section).trim();
		const element = section[0].parentElement;
		if (element && text.length >= 12 && text.length <= 2000) {
			result.push({ section, text, element });
		}
		if (result.length >= 100) break;
	}
	return result;
}

async function main(): Promise<void> {
	if (expectation && expectation !== "no-rule" && expectation !== "rule")
		fail("--expect must be no-rule or rule");
	if (requestedUrl && !/^https?:\/\//i.test(requestedUrl))
		fail("--url must be an HTTP(S) URL");
	if (htmlFile && !requestedUrl)
		fail("--html-file requires --url for the page's real address");
	const config = dryRun || inspect ? {} : await readConfig();
	const apiKey = config.PAIRTRANSLATE_E2E_API_KEY;
	const baseUrl = config.PAIRTRANSLATE_E2E_BASE_URL;
	const model = config.PAIRTRANSLATE_E2E_MODEL;
	if (!dryRun && !inspect && (!apiKey || !baseUrl || !model))
		fail("missing API key, base URL, or model in .env.e2e.local");
	const client =
		dryRun || inspect ? undefined : createOpenAIClient({ apiKey, baseUrl });

	stage = "curl";
	const html = await curlHtml(
		htmlFile
			? pathToFileURL(resolve(htmlFile)).href
			: (requestedUrl ?? fixtureUrl.href),
	);
	const parsed = parseHTML(html).document;
	document.body.innerHTML = parsed.body.innerHTML;
	const pageUrl = requestedUrl
		? new URL(requestedUrl)
		: new URL("https://fixture.invalid/articles/static-layout");
	Object.assign(globalThis, {
		window: { location: pageUrl, dispatchEvent: () => {} },
	});
	console.log(`curl: ok (${html.length} characters)`);

	stage = "extraction";
	const baseline = await collectSamples();
	const diagnostic = baseline.slice(0, 3);
	const chromeCount = baseline.filter((sample) =>
		sample.element.closest("nav, header, aside, footer"),
	).length;
	console.log(
		`extraction: ${baseline.length} samples (${chromeCount} in page chrome)`,
	);
	if (inspect) {
		console.log(
			`inspection: initial sample elements ${diagnostic.map((sample) => sample.element.tagName.toLowerCase()).join(", ")}`,
		);
		return;
	}
	if (diagnostic.length < 2) fail("fewer than two extractable samples");

	stage = "translation";
	const prefix = await Bun.file(
		new URL("../utils/prompt/prefix-system.md", import.meta.url),
	).text();
	const unarySystem = await Bun.file(
		new URL("../utils/prompt/unary-system.md", import.meta.url),
	).text();
	const unaryUser = await Bun.file(
		new URL("../utils/prompt/unary-user.md", import.meta.url),
	).text();
	const adaptationSystem = await Bun.file(
		new URL("../utils/prompt/web-adaptation-system.md", import.meta.url),
	).text();
	const adaptationUser = await Bun.file(
		new URL("../utils/prompt/web-adaptation-user.md", import.meta.url),
	).text();
	const render = (template: string, text: string) =>
		tokensToString(
			buildContextWithTranslateParams({}, { dst: "zh-CN" }, text),
			templateToTokens(template),
		);
	const askTranslation = async (text: string): Promise<string> => {
		if (!client) return "诊断译文";
		const response = await client.chat(
			{
				model: model as string,
				messages: [
					{
						role: "system",
						content: render(`${prefix}\n\n${unarySystem}`, text),
					},
					{ role: "user", content: render(unaryUser, text) },
				],
			},
			undefined,
			AbortSignal.timeout(90_000),
		);
		const output: unknown = response.output;
		if (typeof output !== "string" || !output.trim())
			fail("translation model returned no text");
		return output.trim();
	};
	for (const [index, sample] of diagnostic.entries()) {
		const translation = client
			? await askTranslation(sample.text)
			: `诊断译文 ${index + 1}`;
		recordTranslationObservation(sample.section, sample.text, translation);
	}
	console.log(`translation: ${diagnostic.length} pairs`);

	stage = "snapshot";
	const snapshot = buildPageSnapshot();
	if (snapshot.pairs.length < 2 || snapshot.outline.length === 0)
		fail("snapshot lacks paired translations or DOM outline");
	console.log(
		`snapshot: ${snapshot.outline.length} nodes, ${snapshot.pairs.length} pairs`,
	);

	stage = "runtime";
	const modelId = "00000000-0000-4000-8000-000000000001";
	const rules: AdaptationRule[] = [];
	const settings = {
		services: {},
		translate: {
			filterInteractive: true,
			sourceLang: "auto",
			targetLang: "zh-CN",
			inTextTranslateModel: modelId,
		},
		webAdaptation: { autoEnabled: true, modelId, rules },
	};
	let rawSuggestion: string | undefined;
	let commitCount = 0;
	let replaySuggestion = false;
	const rpc = {
		matchParser: async (domain: string) => {
			const index = matchParser(domain);
			return index === null ? null : PATTERNS_IDX_TO_PARSER_IDX[index];
		},
		unary: async (
			_ctx: unknown,
			options: { promptId: string },
			text: string,
		) => {
			if (options.promptId === PROMPT_ID.translate)
				return { output: await askTranslation(text) };
			if (options.promptId !== PROMPT_ID.webAdaptation)
				fail("unexpected prompt ID");
			if (!replaySuggestion) {
				if (client) {
					const response = await client.chat(
						{
							model: model as string,
							messages: [
								{ role: "system", content: render(adaptationSystem, text) },
								{ role: "user", content: render(adaptationUser, text) },
							],
						},
						undefined,
						AbortSignal.timeout(90_000),
					);
					const output: unknown = response.output;
					if (typeof output !== "string")
						fail("adaptation model returned no text");
					rawSuggestion = output;
				} else {
					rawSuggestion = JSON.stringify({
						roots: ["main#article-content"],
						excludes: ["aside.related-links"],
						promoteTags: [],
					});
				}
			}
			return { output: rawSuggestion };
		},
		commitWebAdaptation: async (input: unknown) => {
			commitCount++;
			const proposal = AdaptationProposalSchema.parse(input);
			const result = upsertAdaptationRule(
				settings.webAdaptation.rules,
				proposal,
				Date.now(),
			);
			settings.webAdaptation.rules = result.rules;
			return result.result;
		},
	};
	Object.assign(window, { rpc });
	mock.module("#imports", () => ({
		browser: { runtime: { onMessage: { addListener: () => {} } } },
	}));
	mock.module("~/utils/rpc/wxt-def", () => ({ waitRpc: async () => {} }));
	mock.module("~/utils/settings/helper", () => ({
		getSettings: async () => settings,
		listenSettings: () => () => {},
	}));
	mock.module("~/utils/settings/services", () => ({
		resolveLLMModel: () => ({}),
	}));
	mock.module("~/utils/page-context", () => ({ getPageContext: () => ({}) }));
	const { runWebAdaptation } = await import(
		"../entrypoints/content/web-adaptation/index"
	);
	const result = await runWebAdaptation("manual");
	stage = "result";
	if (!["added", "updated", "unchanged"].includes(result))
		fail(`runtime returned ${result}`);
	if (!rawSuggestion) fail("adaptation model was not called");
	let parsedSuggestion: unknown;
	try {
		parsedSuggestion = autoStripMarkdown<unknown>(rawSuggestion);
	} catch {
		fail("adaptation model response was not JSON");
	}
	const suggestion = AdaptationSuggestion.safeParse(parsedSuggestion);
	if (!suggestion.success)
		fail("adaptation model response did not match schema");
	const proposed =
		suggestion.data.roots.length +
			suggestion.data.excludes.length +
			suggestion.data.promoteTags.length >
		0;
	console.log(`model: ${proposed ? "proposed a rule" : "no rule needed"}`);
	if (showPatch && proposed) {
		console.log(
			`patch: ${JSON.stringify({
				roots: suggestion.data.roots,
				excludes: suggestion.data.excludes,
				promoteTags: suggestion.data.promoteTags,
			})}`,
		);
	}
	console.log(`runtime: ${result}`);
	if (expectation === "no-rule" && (proposed || result !== "unchanged"))
		fail("model did not choose the expected no-rule outcome");
	if (expectation === "rule" && (!proposed || result !== "added"))
		fail("model did not produce an accepted rule");
	if (result === "added" || result === "updated") {
		if (settings.webAdaptation.rules.length !== 1 || commitCount !== 1)
			fail("runtime did not save exactly one rule");
		const adjacentPath = `${snapshot.pathname.replace(/\/[^/]*$/, "")}/__e2e_adjacent__`;
		if (
			findAdaptationRule(
				settings.webAdaptation.rules,
				snapshot.hostname,
				adjacentPath,
				snapshot.structureKey,
			)
		)
			fail("a single-page rule matched an untested adjacent page");
		const candidate = await collectSamples(
			settings.webAdaptation.rules[0].patch,
		);
		console.log(
			`comparison: ${baseline.length} -> ${candidate.length} samples`,
		);
		replaySuggestion = true;
		const repeated = await runWebAdaptation("manual");
		if (repeated !== "unchanged" || settings.webAdaptation.rules.length !== 1)
			fail("repeated runtime analysis created a duplicate rule");
		console.log("deduplication: repeated runtime analysis unchanged");
	} else if (settings.webAdaptation.rules.length > 0 || commitCount > 0) {
		fail("runtime saved a rule despite reporting unchanged");
	}
	console.log(`${dryRun ? "dry-run" : "live"}: passed`);
}

try {
	await main();
} catch (error) {
	const message = error instanceof Error ? error.message : "unknown error";
	if (message.startsWith(`${stage}:`)) {
		console.error(message);
	} else if (error instanceof LLMError) {
		const original = error.originalError;
		const status =
			typeof original === "object" &&
			original !== null &&
			"status" in original &&
			typeof original.status === "number"
				? `, HTTP ${original.status}`
				: "";
		const kind = original instanceof Error ? `, ${original.name}` : "";
		console.error(`${stage}: ${error.type}${status}${kind}`);
	} else {
		console.error(
			`${stage}: unexpected ${error instanceof Error ? error.name : "error"}`,
		);
	}
	process.exitCode = 1;
}
