import { describe, expect, test } from "bun:test";
import { compilePrompt, initializeConversation } from "./engine";
import { buildContextWithTranslateParams } from "./parser";

const makeBatchPrompt = (systemPrompt: string) =>
	compilePrompt({
		name: "Batch Translate",
		systemPrompt,
		input: "stringArray",
		output: "string",
		steps: [{ message: "{{text}}", output: "string" }],
	});

const renderSystem = (systemPrompt: string, pageContext?: string) => {
	const compiled = makeBatchPrompt(systemPrompt);
	const ctx = buildContextWithTranslateParams(
		pageContext === undefined ? {} : { pageContext },
		{ dst: "en" },
		["hello"],
	);
	return initializeConversation(compiled, ctx)
		.map((message) => message.content)
		.join("\n");
};

describe("pageContext template block", () => {
	const template = [
		"{{#if pageContext}}<context>",
		"{{pageContext}}",
		"</context>{{/if}}",
	].join("\n");

	test("renders the context block when pageContext is present", () => {
		const system = renderSystem(template, "Molecular biology review.");
		expect(system).toContain("<context>");
		expect(system).toContain("Molecular biology review.");
	});

	test("omits the context block when pageContext is absent", () => {
		const system = renderSystem(template);
		expect(system).not.toContain("<context>");
	});

	test("treats empty pageContext as absent", () => {
		const system = renderSystem(template, "");
		expect(system).not.toContain("<context>");
	});
});
