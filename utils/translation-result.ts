import { PROMPT_ID } from "~/utils/constants";

export type TranslationSkipped = boolean | boolean[];

export type TranslationResponse<T> = {
	output: T;
	reasoning?: string;
	skipped: TranslationSkipped;
	/** Per-position error messages when a batch partially succeeds. */
	errors?: (string | undefined)[];
};

/**
 * Webpage adaptation is a structural analysis: its payload mixes the page's
 * own text with the target-language translations, so a language guess over it
 * says nothing about the page. Its prompts never use the language settings.
 * Without this exemption the analysis is short-circuited precisely when
 * translation has produced enough pairs to analyse.
 */
export type TranslationStreamChunk = {
	content?: string;
	reasoning?: string;
	skipped?: boolean;
};

export const shouldSkipSameLanguage = (promptId: string): boolean =>
	promptId !== PROMPT_ID.summary &&
	promptId !== PROMPT_ID.pageContext &&
	promptId !== PROMPT_ID.webAdaptation;

export const skippedForPayload = (
	payload: string | string[],
): TranslationSkipped =>
	Array.isArray(payload) ? payload.map(() => true) : true;

const normalizeComparableText = (text: string): string =>
	text.normalize("NFC").trim().replace(/\s+/g, " ");

const isSameText = (source: string, output: unknown): boolean =>
	typeof output === "string" &&
	normalizeComparableText(source) === normalizeComparableText(output);

export const getIdenticalTranslationSkipped = (
	payload: string | string[],
	output: unknown,
	promptId: string,
	errors?: (string | undefined)[],
): TranslationSkipped => {
	if (!shouldSkipSameLanguage(promptId)) {
		return Array.isArray(payload) ? payload.map(() => false) : false;
	}

	if (Array.isArray(payload)) {
		return payload.map(
			(source, index) =>
				!errors?.[index] &&
				Array.isArray(output) &&
				isSameText(source, output[index]),
		);
	}

	return isSameText(payload, output);
};

export const createTranslationResponse = <T>(
	payload: string | string[],
	output: T,
	promptId: string,
	options: {
		reasoning?: string;
		skipped?: TranslationSkipped;
		errors?: (string | undefined)[];
	} = {},
): TranslationResponse<T> => ({
	output,
	reasoning: options.reasoning,
	skipped:
		options.skipped ??
		getIdenticalTranslationSkipped(payload, output, promptId, options.errors),
	...(options.errors ? { errors: options.errors } : {}),
});
