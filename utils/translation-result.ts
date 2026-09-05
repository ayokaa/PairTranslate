import { PROMPT_ID } from "~/utils/constants";

export type TranslationSkipped = boolean | boolean[];

export type TranslationResponse<T> = {
	output: T;
	reasoning?: string;
	skipped: TranslationSkipped;
};

export type TranslationStreamChunk = {
	content?: string;
	reasoning?: string;
	skipped?: boolean;
};

export const shouldSkipSameLanguage = (promptId: string): boolean =>
	promptId !== PROMPT_ID.summary && promptId !== PROMPT_ID.pageContext;

export const skippedForPayload = (
	payload: string | string[],
): TranslationSkipped =>
	Array.isArray(payload) ? payload.map(() => true) : true;

const isSameText = (source: string, output: unknown): boolean =>
	typeof output === "string" &&
	source.normalize("NFC") === output.normalize("NFC");

export const getIdenticalTranslationSkipped = (
	payload: string | string[],
	output: unknown,
	promptId: string,
): TranslationSkipped => {
	if (!shouldSkipSameLanguage(promptId)) {
		return Array.isArray(payload) ? payload.map(() => false) : false;
	}

	if (Array.isArray(payload)) {
		return payload.map(
			(source, index) =>
				Array.isArray(output) && isSameText(source, output[index]),
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
	} = {},
): TranslationResponse<T> => ({
	output,
	reasoning: options.reasoning,
	skipped:
		options.skipped ??
		getIdenticalTranslationSkipped(payload, output, promptId),
});
