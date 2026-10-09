import { describe, expect, test } from "bun:test";
import type { QueueControlSettings, ServiceSettings } from "~/utils/settings";
import {
	findServiceForModelRef,
	resolveLLMModel,
	resolveQueueSettings,
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

describe("pre-migration tolerance", () => {
	// A page can read storage before the background worker finishes migrating
	// v9 data, whose LLM services lack `models`. Deliberately cast the legacy
	// shape to exercise the guard.
	const legacy = {
		"11111111-1111-4111-8111-111111111111": {
			type: "llm",
			name: "LegacyOpenAI",
			apiSpec: "openai",
			model: "gpt-5",
		},
	} as unknown as Record<string, ServiceSettings>;

	test("helpers degrade to empty results instead of throwing", () => {
		expect(() => selectLLMModelOptions(legacy)).not.toThrow();
		expect(selectLLMModelOptions(legacy)).toEqual([]);
		expect(
			resolveLLMModel(legacy, "22222222-2222-4222-8222-222222222222"),
		).toBeUndefined();
		expect(
			findServiceForModelRef(legacy, "22222222-2222-4222-8222-222222222222"),
		).toBeUndefined();
	});
});

describe("resolveQueueSettings", () => {
	const defaults: QueueControlSettings = {
		requestConcurrency: 4,
		tokensPerMinute: 60000,
		maxBatchSize: 8,
		maxTokensPerBatch: 8000,
		cacheSize: 1000,
	};

	const queueServices: Record<string, ServiceSettings> = {
		"11111111-1111-4111-8111-111111111111": {
			type: "llm",
			name: "OpenAI",
			apiSpec: "openai",
			queue: { requestConcurrency: 2, maxBatchSize: 16 },
			models: {
				"22222222-2222-4222-8222-222222222222": { name: "gpt-5" },
				"33333333-3333-4333-8333-333333333333": {
					name: "gpt-5-mini",
					queue: { requestConcurrency: 1, maxTokensPerBatch: 2000 },
				},
			},
		},
		"44444444-4444-4444-8444-444444444444": {
			type: "traditional",
			name: "DeepL",
			apiSpec: "deepl",
			queue: { tokensPerMinute: 30000 },
		},
	};

	test("falls back to the global defaults without a reference", () => {
		const global = {
			requestConcurrency: 4,
			tokensPerMinute: 60000,
			maxBatchSize: 8,
			maxTokensPerBatch: 8000,
		};
		expect(resolveQueueSettings(queueServices, defaults, undefined)).toEqual(
			global,
		);
		expect(
			resolveQueueSettings(
				queueServices,
				defaults,
				"99999999-9999-4999-8999-999999999999",
			),
		).toEqual(global);
	});

	test("applies service overrides per field for models without their own", () => {
		expect(
			resolveQueueSettings(
				queueServices,
				defaults,
				"22222222-2222-4222-8222-222222222222",
			),
		).toEqual({
			requestConcurrency: 2,
			tokensPerMinute: 60000,
			maxBatchSize: 16,
			maxTokensPerBatch: 8000,
		});
	});

	test("traditional services use their own override", () => {
		expect(
			resolveQueueSettings(
				queueServices,
				defaults,
				"44444444-4444-4444-8444-444444444444",
			),
		).toEqual({
			requestConcurrency: 4,
			tokensPerMinute: 30000,
			maxBatchSize: 8,
			maxTokensPerBatch: 8000,
		});
	});

	test("model overrides win per field over the service override", () => {
		expect(
			resolveQueueSettings(
				queueServices,
				defaults,
				"33333333-3333-4333-8333-333333333333",
			),
		).toEqual({
			requestConcurrency: 1,
			tokensPerMinute: 60000,
			maxBatchSize: 16,
			maxTokensPerBatch: 2000,
		});
	});
});
