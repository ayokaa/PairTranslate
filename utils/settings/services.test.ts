import { describe, expect, test } from "bun:test";
import type { ServiceSettings } from "~/utils/settings";
import {
	findServiceForModelRef,
	resolveLLMModel,
	selectLLMModelOptions,
} from "./services";

const services: Record<string, ServiceSettings> = {
	"11111111-1111-4111-8111-111111111111": {
		type: "llm",
		name: "OpenAI",
		apiSpec: "openai",
		baseUrl: "https://api.openai.com/v1",
		models: {
			"22222222-2222-4222-8222-222222222222": { name: "gpt-5" },
			"33333333-3333-4333-8333-333333333333": {
				name: "gpt-5-mini",
				temperature: 0.3,
			},
		},
	},
	"44444444-4444-4444-8444-444444444444": {
		type: "traditional",
		name: "DeepL",
		apiSpec: "deepl",
	},
};

describe("resolveLLMModel", () => {
	test("finds a model and its parent service by model UUID", () => {
		const resolved = resolveLLMModel(
			services,
			"33333333-3333-4333-8333-333333333333",
		);
		expect(resolved?.serviceId).toBe("11111111-1111-4111-8111-111111111111");
		expect(resolved?.service.name).toBe("OpenAI");
		expect(resolved?.model).toEqual({ name: "gpt-5-mini", temperature: 0.3 });
	});

	test("returns undefined for unknown, traditional, or empty references", () => {
		expect(
			resolveLLMModel(services, "99999999-9999-4999-8999-999999999999"),
		).toBeUndefined();
		expect(
			resolveLLMModel(services, "44444444-4444-4444-8444-444444444444"),
		).toBeUndefined();
		expect(resolveLLMModel(services, undefined)).toBeUndefined();
	});
});

describe("findServiceForModelRef", () => {
	test("resolves traditional services directly and LLM models to their parent", () => {
		expect(
			findServiceForModelRef(services, "44444444-4444-4444-8444-444444444444")
				?.name,
		).toBe("DeepL");
		expect(
			findServiceForModelRef(services, "22222222-2222-4222-8222-222222222222")
				?.name,
		).toBe("OpenAI");
		expect(findServiceForModelRef(services, undefined)).toBeUndefined();
	});
});

describe("selectLLMModelOptions", () => {
	test("enumerates every service/model pair, skipping traditional services", () => {
		expect(selectLLMModelOptions(services)).toEqual([
			{
				value: "22222222-2222-4222-8222-222222222222",
				label: "OpenAI / gpt-5",
			},
			{
				value: "33333333-3333-4333-8333-333333333333",
				label: "OpenAI / gpt-5-mini",
			},
		]);
	});
});
