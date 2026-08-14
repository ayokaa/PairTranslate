import type {
	LLMModelSettings,
	ServiceSettings,
	ServicesSettings,
} from "./def";
import { SettingsSchema } from "./def";
import {
	generateDebugSettings,
	generatePromptSettings,
	generateQueueControlSettings,
	generateSummarySettings,
	generateTranslateSettings,
} from "./default";
import { SETTINGS_VERSION } from "./version";

type LegacyLLMService = {
	name: string;
	baseUrl: string;
	apiSpec: "openai" | "anthropic" | "google";
	apiKey?: string;
	model: string;
	temperature?: number;
	maxOutputTokens?: number;
};

type LegacyTraditionalService = {
	name: string;
	baseUrl?: string;
	apiSpec: "microsoft" | "google" | "deepl" | "deeplx" | "browser";
	apiKey?: string;
	region?: string;
};

type LegacyServices = {
	llmServices?: Record<string, LegacyLLMService>;
	traditionalServices?: Record<string, LegacyTraditionalService>;
};

type LegacyTranslateSettings = {
	sourceLang: string;
	targetLang: string;
	filterInteractive: boolean;
	concurrentRequests: number;
	maxBatchSize: number;
	cacheSize: number;
	translationMode: "parallel" | "replace";
	inTextTranslateIconEnabled?: boolean;
	translateFullPage: boolean;
	inTextTranslateModel?: string;
	floatingTranslateModel?: string;
	floatingExplainModel?: string;
	inputTranslateModel?: string;
	inputTranslateLang: string;
};

type SettingsV1 = Omit<SettingsSchema, "debug"> & { __v: 1 };

type LegacySettingsV0 = Omit<SettingsV1, "services" | "prompts" | "summary"> & {
	services?: LegacyServices;
	prompts?: SettingsSchema["prompts"];
	translate?: LegacyTranslateSettings;
	__v?: number;
};

type LegacyTranslateSettingsV8 = SettingsSchema["translate"] & {
	summaryModel?: string;
	summaryExcludedSites?: string[];
	summaryDefaultPinned?: boolean;
	summaryGeometryMaxEntries?: number;
};

type LegacySettingsV8 = Omit<SettingsSchema, "translate" | "summary"> & {
	translate: LegacyTranslateSettingsV8;
};

// v9 LLM service: provider config plus a single inline `model` and
// service-level generation params. v10 nests models under `models`.
type LegacyLLMServiceV9 = Omit<
	Extract<ServiceSettings, { type: "llm" }>,
	"models"
> & {
	model?: string;
	temperature?: number;
	maxOutputTokens?: number;
	thinkingBudget?: LLMModelSettings["thinkingBudget"];
	extraBody?: Record<string, unknown>;
};

type LegacySettingsV9 = Omit<SettingsSchema, "services"> & {
	services: Record<string, LegacyLLMServiceV9 | ServiceSettings>;
};

export const migrateSettings = (raw: unknown): SettingsSchema => {
	if (!raw || typeof raw !== "object") {
		throw new Error("Cannot migrate invalid settings payload");
	}

	let working: unknown = raw;
	let version = getSettingsVersion(raw);

	while (version < SETTINGS_VERSION) {
		if (version === 0) {
			working = migrateV0ToV1(working as LegacySettingsV0);
			version = 1;
			continue;
		}
		if (version === 1) {
			working = migrateV1ToV2(working as SettingsV1);
			version = 2;
			continue;
		}
		if (version === 2) {
			working = migrateV2ToV3(working as SettingsSchema);
			version = 3;
			continue;
		}
		if (version === 3) {
			working = migrateV3ToV4(working as LegacySettingsV8);
			version = 4;
			continue;
		}
		if (version === 4) {
			working = migrateV4ToV5(working as LegacySettingsV8);
			version = 5;
			continue;
		}
		if (version === 5) {
			working = migrateV5ToV6(working as LegacySettingsV8);
			version = 6;
			continue;
		}
		if (version === 6) {
			working = migrateV6ToV7(working as LegacySettingsV8);
			version = 7;
			continue;
		}
		if (version === 7) {
			working = migrateV7ToV8(working as LegacySettingsV8);
			version = 8;
			continue;
		}
		if (version === 8) {
			working = migrateV8ToV9(working as LegacySettingsV8);
			version = 9;
			continue;
		}
		if (version === 9) {
			working = migrateV9ToV10(working as LegacySettingsV9);
			version = 10;
			continue;
		}

		throw new Error(`Unsupported settings version: ${version}`);
	}

	const parsed = SettingsSchema.safeParse(working);
	if (!parsed.success) {
		throw new Error(
			`Invalid settings after migration: ${parsed.error.message}`,
		);
	}
	return parsed.data;
};

function migrateV0ToV1(oldSettings: LegacySettingsV0): SettingsV1 {
	const services = convertLegacyServices(oldSettings.services);
	const translate = getModernTranslateSettings(oldSettings.translate);
	const queue = buildQueueSettings(oldSettings.translate);
	return {
		basic: oldSettings.basic,
		translate: translate,
		websiteRules: oldSettings.websiteRules ?? [],
		queue,
		services,
		prompts: oldSettings.prompts ?? generatePromptSettings(),
		summary: generateSummarySettings(),
		__v: 1,
	};
}

function migrateV1ToV2(oldSettings: SettingsV1): SettingsSchema {
	return {
		...oldSettings,
		debug: generateDebugSettings(),
		__v: 2,
	};
}

function migrateV2ToV3(oldSettings: SettingsSchema): SettingsSchema {
	// For v3 we reset prompts to the new defaults. Keep other settings as-is.
	return {
		...oldSettings,
		prompts: generatePromptSettings(),
		__v: 3,
	};
}

function migrateV3ToV4(oldSettings: LegacySettingsV8): LegacySettingsV8 {
	return {
		...oldSettings,
		translate: {
			...oldSettings.translate,
			summaryModel: undefined,
		},
		basic: {
			...oldSettings.basic,
			keyboardShortcutSummarizes: false,
			keyboardShortcutForSummary: "Alt+T",
		},
		prompts: generatePromptSettings(),
		__v: 4,
	};
}

function convertLegacyServices(legacy?: LegacyServices): ServicesSettings {
	const next: ServicesSettings = {};
	const llmEntries = legacy?.llmServices ?? {};
	Object.entries(llmEntries).forEach(([id, service]) => {
		const models: Record<string, LLMModelSettings> = {};
		if (service.model) {
			// Reuse the service UUID as the model key so legacy references keep working.
			models[id] = {
				name: service.model,
				...(service.temperature !== undefined && {
					temperature: service.temperature,
				}),
				...(service.maxOutputTokens !== undefined && {
					maxOutputTokens: service.maxOutputTokens,
				}),
			};
		}
		next[id] = {
			type: "llm",
			name: service.name,
			baseUrl: service.baseUrl,
			apiSpec: service.apiSpec,
			apiKey: service.apiKey,
			models,
		};
	});

	const traditionalEntries = legacy?.traditionalServices ?? {};
	Object.entries(traditionalEntries).forEach(([id, service]) => {
		next[id] = {
			type: "traditional",
			name: service.name,
			baseUrl: service.baseUrl,
			apiSpec: service.apiSpec,
			apiKey: service.apiKey,
			region: service.region,
		};
	});

	return next;
}

function getModernTranslateSettings(
	legacy?: LegacyTranslateSettings,
): SettingsSchema["translate"] {
	if (!legacy) {
		return generateTranslateSettings();
	}

	const defaults = generateTranslateSettings();
	const { concurrentRequests, maxBatchSize, cacheSize, ...rest } = legacy;
	void concurrentRequests;
	void maxBatchSize;
	void cacheSize;
	return {
		...defaults,
		...rest,
	};
}

function buildQueueSettings(
	legacy?: LegacyTranslateSettings,
): SettingsSchema["queue"] {
	const defaults = generateQueueControlSettings();

	return {
		requestConcurrency:
			legacy?.concurrentRequests ?? defaults.requestConcurrency,
		tokensPerMinute: defaults.tokensPerMinute,
		maxBatchSize: legacy?.maxBatchSize ?? defaults.maxBatchSize,
		maxTokensPerBatch: defaults.maxTokensPerBatch,
		cacheSize: legacy?.cacheSize ?? defaults.cacheSize,
	};
}

function migrateV4ToV5(oldSettings: LegacySettingsV8): LegacySettingsV8 {
	return {
		...oldSettings,
		translate: {
			...oldSettings.translate,
			summaryExcludedSites: [],
		},
		__v: 5,
	};
}

function migrateV5ToV6(oldSettings: LegacySettingsV8): LegacySettingsV8 {
	return {
		...oldSettings,
		translate: {
			...oldSettings.translate,
			summaryDefaultPinned: false,
		},
		__v: 6,
	};
}

function migrateV6ToV7(oldSettings: LegacySettingsV8): LegacySettingsV8 {
	return {
		...oldSettings,
		basic: {
			...oldSettings.basic,
			restorePageState: true,
		},
		__v: 7,
	};
}

function migrateV7ToV8(oldSettings: LegacySettingsV8): LegacySettingsV8 {
	return {
		...oldSettings,
		translate: {
			...oldSettings.translate,
			summaryGeometryMaxEntries: 1000,
		},
		__v: 8,
	};
}

function migrateV8ToV9(oldSettings: LegacySettingsV8): SettingsSchema {
	const {
		summaryModel,
		summaryDefaultPinned,
		summaryGeometryMaxEntries,
		summaryExcludedSites,
		...restTranslate
	} = oldSettings.translate;

	const summaryRules = (summaryExcludedSites ?? []).map((pattern) => ({
		urlPatterns: [pattern],
		enableSummary: false,
	}));

	return {
		...oldSettings,
		translate: restTranslate as SettingsSchema["translate"],
		summary: {
			summaryModel,
			summaryDefaultPinned: summaryDefaultPinned ?? false,
			summaryGeometryMaxEntries: summaryGeometryMaxEntries ?? 1000,
		},
		websiteRules: [...oldSettings.websiteRules, ...summaryRules],
		__v: 9,
	};
}

function migrateV9ToV10(oldSettings: LegacySettingsV9): SettingsSchema {
	const services: ServicesSettings = {};
	for (const [id, service] of Object.entries(oldSettings.services)) {
		if (service.type !== "llm") {
			services[id] = service;
			continue;
		}
		// Already in the v10 shape (produced by convertLegacyServices on the v0 path).
		if ("models" in service) {
			services[id] = service;
			continue;
		}
		const {
			model,
			temperature,
			maxOutputTokens,
			thinkingBudget,
			extraBody,
			...rest
		} = service;
		const models: Record<string, LLMModelSettings> = {};
		if (model) {
			// Reuse the service UUID as the model key so every existing reference
			// (translate.*, summary.summaryModel, websiteRules) keeps pointing at it.
			models[id] = {
				name: model,
				...(temperature !== undefined && { temperature }),
				...(maxOutputTokens !== undefined && { maxOutputTokens }),
				...(thinkingBudget !== undefined && { thinkingBudget }),
				...(extraBody !== undefined && { extraBody }),
			};
		}
		services[id] = { ...rest, models };
	}
	return { ...oldSettings, services, __v: 10 };
}

function getSettingsVersion(raw: unknown): number {
	if (raw && typeof raw === "object" && "__v" in raw) {
		const candidate = (raw as { __v?: unknown }).__v;
		if (typeof candidate === "number") {
			return candidate;
		}
	}
	return 0;
}
