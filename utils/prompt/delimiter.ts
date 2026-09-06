import { createTranslateError, TranslateErrorType } from "~/utils/errors";
import type { PromptSettings } from "~/utils/settings";

export type PromptStepOutput = PromptSettings["steps"][number]["output"];
export type StringArrayStepOutput = Extract<
	PromptStepOutput,
	{ type: "stringArray" }
>;
export type RegexDelimiterConfig = Extract<
	StringArrayStepOutput["delimiter"],
	{ type: "regex" }
>;

const DEFAULT_REGEX_FLAGS = "gm";

const isRegexDelimiterConfig = (
	delimiter: StringArrayStepOutput["delimiter"],
): delimiter is RegexDelimiterConfig =>
	Boolean(
		delimiter &&
			typeof delimiter === "object" &&
			"type" in delimiter &&
			delimiter.type === "regex" &&
			typeof delimiter.pattern === "string",
	);

export const isStringArrayOutput = (
	output: PromptStepOutput,
): output is StringArrayStepOutput =>
	typeof output === "object" &&
	output !== null &&
	"type" in output &&
	output.type === "stringArray";

export const resolveStringArrayDelimiter = (
	output: StringArrayStepOutput,
): string | RegExp => {
	const rawDelimiter = output.delimiter ?? "\n";
	if (!isRegexDelimiterConfig(rawDelimiter)) {
		return rawDelimiter;
	}
	const flags = rawDelimiter.flags?.trim()
		? rawDelimiter.flags
		: DEFAULT_REGEX_FLAGS;
	try {
		return new RegExp(rawDelimiter.pattern, flags);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw createTranslateError(
			TranslateErrorType.INVALID_PROMPT,
			`Invalid regex delimiter: ${reason}`,
		);
	}
};

export const splitWithDelimiter = (
	value: string,
	delimiter: string | RegExp,
): string[] =>
	value
		.split(delimiter)
		.map((entry) => entry.trim())
		.filter(Boolean);

/**
 * A whole-output code fence wraps everything the model produced; keeping it
 * would turn the fence lines into phantom segments. The closing fence is
 * optional so truncated outputs are unwrapped too.
 */
const OUTER_FENCE = /^\s*```[^\n]*\n([\s\S]*?)(?:\n\s*```\s*)?$/;

export const stripOuterFence = (value: string): string =>
	OUTER_FENCE.exec(value)?.[1] ?? value;

export type DetailedSegment = {
	text: string;
	/** Index extracted from the delimiter text (e.g. "==== 12" -> 12). */
	index: number | undefined;
};

/**
 * Like splitWithDelimiter, but keeps the delimiter match of each segment so
 * numbered delimiters reveal which input position a segment belongs to.
 */
export const splitWithDelimiterDetailed = (
	value: string,
	delimiter: string | RegExp,
): DetailedSegment[] => {
	if (typeof delimiter === "string") {
		return splitWithDelimiter(value, delimiter).map((text) => ({
			text,
			index: undefined,
		}));
	}
	const flags = delimiter.flags.includes("g")
		? delimiter.flags
		: `${delimiter.flags}g`;
	const matches = [...value.matchAll(new RegExp(delimiter.source, flags))];
	if (matches.length === 0) {
		const text = value.trim();
		return text ? [{ text, index: undefined }] : [];
	}
	const segments: DetailedSegment[] = [];
	const preamble = value.slice(0, matches[0].index).trim();
	if (preamble) {
		segments.push({ text: preamble, index: undefined });
	}
	for (let i = 0; i < matches.length; i++) {
		const match = matches[i];
		const start = (match.index ?? 0) + match[0].length;
		const end = i + 1 < matches.length ? matches[i + 1].index : value.length;
		const text = value.slice(start, end).trim();
		if (!text) continue;
		const indexText = match[0].match(/\d+/);
		segments.push({
			text,
			index: indexText ? Number.parseInt(indexText[0], 10) : undefined,
		});
	}
	return segments;
};

export type SegmentAlignment = {
	values: (string | undefined)[];
	missing: number[];
	/** True when placement came from delimiter indices rather than position. */
	indexed: boolean;
};

/**
 * Place segments onto the expected positions. Index-based placement is used
 * only when every numbered segment carries a unique in-range index and any
 * unindexed segment is leading junk (a preamble); otherwise the segments must
 * match positionally one-to-one. Anything else leaves every position missing
 * so the caller can re-request instead of silently misplacing translations.
 */
export const alignSegments = (
	segments: DetailedSegment[],
	expected: number,
): SegmentAlignment => {
	const values: (string | undefined)[] = new Array(expected).fill(undefined);
	const firstIndexed = segments.findIndex(
		(segment) => segment.index !== undefined,
	);
	const indices = segments.flatMap((segment) =>
		segment.index === undefined ? [] : [segment.index],
	);
	const usable =
		firstIndexed !== -1 &&
		segments.every(
			(segment, i) => segment.index !== undefined || i < firstIndexed,
		) &&
		new Set(indices).size === indices.length &&
		indices.every((index) => index >= 0 && index < expected);
	if (usable) {
		for (const segment of segments) {
			if (segment.index !== undefined) values[segment.index] = segment.text;
		}
	} else if (segments.length === expected) {
		segments.forEach((segment, i) => {
			values[i] = segment.text;
		});
	}
	const missing: number[] = [];
	for (let i = 0; i < expected; i++) {
		if (values[i] === undefined) missing.push(i);
	}
	return { values, missing, indexed: usable };
};
