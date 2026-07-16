import { describe, expect, test } from "bun:test";
import { PROMPT_ID } from "./constants";
import {
	createTranslationResponse,
	getIdenticalTranslationSkipped,
	skippedForPayload,
} from "./translation-result";

describe("translation skipped state", () => {
	test("marks direct same-language skips for every payload item", () => {
		expect(skippedForPayload("Already translated")).toBe(true);
		expect(skippedForPayload(["One", "Two"])).toEqual([true, true]);
	});

	test("marks unchanged batch outputs per item", () => {
		expect(
			getIdenticalTranslationSkipped(
				["Same", "需要转换"],
				["Same", "需要轉換"],
				PROMPT_ID.batchTranslate,
			),
		).toEqual([true, false]);
	});

	test("does not skip an actual Chinese variant conversion", () => {
		const response = createTranslationResponse(
			"需要转换",
			"需要轉換",
			PROMPT_ID.translate,
		);

		expect(response.skipped).toBe(false);
	});

	test("does not apply identical-output skipping to summaries", () => {
		expect(
			getIdenticalTranslationSkipped(
				"Summary source",
				"Summary source",
				PROMPT_ID.summary,
			),
		).toBe(false);
	});

	test("preserves an explicit backend skip decision", () => {
		const response = createTranslationResponse(
			"Source",
			"",
			PROMPT_ID.translate,
			{ skipped: true },
		);

		expect(response).toEqual({
			output: "",
			reasoning: undefined,
			skipped: true,
		});
	});
});
