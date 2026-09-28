import { beforeEach, expect, test } from "bun:test";
import "~/utils/test/dom-setup";
import {
	clearTranslationObservations,
	MAX_ADAPTATION_SOURCE_CHARACTERS,
	recordTranslationObservation,
} from "./observations";
import { buildPageSnapshot, matchUntranslatedEvidence } from "./snapshot";

Object.assign(globalThis, {
	window: { location: { hostname: "example.com", pathname: "/article" } },
});

beforeEach(() => {
	clearTranslationObservations();
	document.body.innerHTML = `
		<main class="article">
			<p class="first">Same source text</p>
			<p class="second">Same source text</p>
			<p class="third">Same source text</p>
		</main>
	`;
});

test("merges identical pairs across DOM sections and retains distinct translations", () => {
	const paragraphs = document.querySelectorAll("p");
	const firstNode = paragraphs[0]?.firstChild;
	const secondNode = paragraphs[1]?.firstChild;
	const thirdNode = paragraphs[2]?.firstChild;
	if (!firstNode || !secondNode || !thirdNode) {
		throw new Error("Expected three paragraph text nodes");
	}

	recordTranslationObservation(
		[firstNode, firstNode],
		"Same source text",
		"相同译文",
	);
	recordTranslationObservation(
		[secondNode, secondNode],
		"Same   source text",
		"相同译文",
	);
	recordTranslationObservation(
		[thirdNode, thirdNode],
		"Same source text",
		"不同译文",
	);

	expect(buildPageSnapshot().pairs).toEqual([
		{
			paths: ["main.article > p.first", "main.article > p.second"],
			source: "Same source text",
			translation: "相同译文",
			occurrences: 2,
		},
		{
			paths: ["main.article > p.third"],
			source: "Same source text",
			translation: "不同译文",
			occurrences: 1,
		},
	]);
});

test("keeps translated samples across more than the outline element limit", () => {
	const main = document.createElement("main");
	const sampleCount = 601;
	for (let index = 0; index < sampleCount; index++) {
		const paragraph = document.createElement("p");
		paragraph.textContent = `Source sample ${index}`;
		main.append(paragraph);
	}
	document.body.replaceChildren(main);
	for (const [index, paragraph] of [...main.querySelectorAll("p")].entries()) {
		const node = paragraph.firstChild;
		if (!node) throw new Error("Expected paragraph text");
		recordTranslationObservation(
			[node, node],
			`Source sample ${index}`,
			`译文 ${index}`,
		);
	}

	const snapshot = buildPageSnapshot();
	expect(snapshot.outline).toHaveLength(600);
	expect(snapshot.pairs).toHaveLength(sampleCount);
});

test("omits a pair over the text budget instead of truncating it", () => {
	const node = document.querySelector("p")?.firstChild;
	if (!node) throw new Error("Expected paragraph text");

	recordTranslationObservation(
		[node, node],
		"x".repeat(MAX_ADAPTATION_SOURCE_CHARACTERS + 1),
		"超长译文",
	);

	expect(buildPageSnapshot().pairs).toHaveLength(0);
});

test("keeps a complete translation when the source stays within budget", () => {
	const node = document.querySelector("p")?.firstChild;
	if (!node) throw new Error("Expected paragraph text");
	const translation = "译".repeat(MAX_ADAPTATION_SOURCE_CHARACTERS + 1);

	recordTranslationObservation([node, node], "Short source text", translation);

	expect(buildPageSnapshot().pairs).toEqual([
		{
			paths: ["main.article > p.first"],
			source: "Short source text",
			translation,
			occurrences: 1,
		},
	]);
});

test("counts repeated source text once when translations differ", () => {
	const paragraphs = document.querySelectorAll("p");
	const first = paragraphs[0]?.firstChild;
	const second = paragraphs[1]?.firstChild;
	if (!first || !second) throw new Error("Expected paragraph text nodes");
	const source = "x".repeat(
		Math.floor(MAX_ADAPTATION_SOURCE_CHARACTERS / 2) + 1,
	);

	recordTranslationObservation([first, first], source, "First translation");
	recordTranslationObservation([second, second], source, "Second translation");

	expect(buildPageSnapshot().pairs).toHaveLength(2);
});

test("continues past a pair that does not fit the remaining source budget", () => {
	const element = document.querySelector("p");
	if (!element) throw new Error("Expected paragraph element");
	const largeSource = "a".repeat(40_000);
	const omittedSource = "b".repeat(20_000);

	const snapshot = buildPageSnapshot([
		{ source: largeSource, translation: "译文一", element },
		{ source: omittedSource, translation: "译文二", element },
		{ source: "Later sample still fits", translation: "译文三", element },
	]);

	expect(snapshot.pairs.map((pair) => pair.source)).toEqual([
		largeSource,
		"Later sample still fits",
	]);
});

test("sends safe untranslated candidates alongside translated pairs", () => {
	const candidate = document.createElement("p");
	candidate.className = "filtered";
	candidate.textContent = "Filtered body paragraph";
	document.querySelector("main")?.append(candidate);
	expect(
		buildPageSnapshot(
			[],
			[{ text: "Filtered body paragraph", element: candidate }],
		),
	).toMatchObject({
		untranslated: [
			{
				paths: ["main.article > p.filtered"],
				text: "Filtered body paragraph",
				occurrences: 1,
			},
		],
	});
});

test("shares the source-character budget between translated and untranslated text", () => {
	const article = document.querySelector("main");
	const translated = document.createElement("p");
	const untranslated = document.createElement("p");
	article?.append(translated, untranslated);
	const translatedNode = translated.appendChild(document.createTextNode("x"));
	const source = "x".repeat(MAX_ADAPTATION_SOURCE_CHARACTERS);
	recordTranslationObservation(
		[translatedNode, translatedNode],
		source,
		"译文",
	);
	expect(
		buildPageSnapshot(
			[],
			[{ text: "Filtered paragraph", element: untranslated }],
		),
	).toMatchObject({ untranslated: [] });
});

test("matches snapshot evidence by both normalized text and DOM path", () => {
	const candidate = document.querySelector("p.first");
	if (!candidate) throw new Error("Expected candidate paragraph");
	const samples = [{ text: "Same   source text", element: candidate }];
	const accepted = buildPageSnapshot([], samples).untranslated;

	expect(matchUntranslatedEvidence(samples, accepted)).toEqual(samples);
	expect(
		matchUntranslatedEvidence(samples, [
			{ ...accepted[0]!, paths: ["unrelated.path"] },
		]),
	).toEqual([]);
});
