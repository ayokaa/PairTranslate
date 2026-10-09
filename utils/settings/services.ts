import type {
	LLMModelSettings,
	QueueControlSettings,
	QueueOverride,
	ServiceSettings,
} from "~/utils/settings";

export type ServiceByType<TType extends ServiceSettings["type"]> = Extract<
	ServiceSettings,
	{ type: TType }
>;

export type LLMServiceSettings = ServiceByType<"llm">;

export interface ResolvedLLMModel {
	serviceId: string;
	service: LLMServiceSettings;
	modelId: string;
	model: LLMModelSettings;
}

/**
 * Look up an LLM model by its UUID across all services. Model references
 * (translate.*, summary.summaryModel, websiteRules) point at model UUIDs.
 */
export function resolveLLMModel(
	services: Record<string, ServiceSettings>,
	modelId: string | undefined,
): ResolvedLLMModel | undefined {
	if (!modelId) return undefined;
	for (const [serviceId, service] of Object.entries(services)) {
		if (service.type !== "llm") continue;
		// Tolerate pre-migration (v9) data that still lacks `models`: a page
		// can read storage before the background worker finishes migrating.
		const models: Record<string, LLMModelSettings> | undefined = service.models;
		const model = models?.[modelId];
		if (model) {
			return { serviceId, service, modelId, model };
		}
	}
	return undefined;
}

/**
 * Find the owning service for a model reference: a traditional service UUID
 * resolves directly, an LLM model UUID resolves to its parent service.
 */
export function findServiceForModelRef(
	services: Record<string, ServiceSettings>,
	modelId: string | undefined,
): ServiceSettings | undefined {
	if (!modelId) return undefined;
	const direct = services[modelId];
	if (direct) return direct;
	return resolveLLMModel(services, modelId)?.service;
}

/** The four flow-control limits a queue override can set, fully resolved. */
export type EffectiveQueueSettings = Required<QueueOverride>;

/**
 * Resolve flow-control limits for a model reference. Precedence is model
 * override -> owning service override -> global defaults; unknown or missing
 * references fall through to the global defaults.
 */
export function resolveQueueSettings(
	services: Record<string, ServiceSettings>,
	defaults: QueueControlSettings,
	modelId: string | undefined,
): EffectiveQueueSettings {
	const resolved = resolveLLMModel(services, modelId);
	const service =
		resolved?.service ?? findServiceForModelRef(services, modelId);
	const serviceQueue = service?.queue;
	const modelQueue = resolved?.model.queue;
	const pick = (key: keyof QueueOverride): number =>
		modelQueue?.[key] ?? serviceQueue?.[key] ?? defaults[key];

	return {
		requestConcurrency: pick("requestConcurrency"),
		tokensPerMinute: pick("tokensPerMinute"),
		maxBatchSize: pick("maxBatchSize"),
		maxTokensPerBatch: pick("maxTokensPerBatch"),
	};
}

export function formatLLMModelLabel(
	serviceName: string,
	modelName: string,
): string {
	return `${serviceName} / ${modelName}`;
}

/** Enumerate every (service, model) pair as picker options. */
export function selectLLMModelOptions(
	services: Record<string, ServiceSettings>,
): Array<{ value: string; label: string }> {
	const options: Array<{ value: string; label: string }> = [];
	for (const service of Object.values(services)) {
		if (service.type !== "llm") continue;
		// See resolveLLMModel: pre-migration data may lack `models`.
		const models: Record<string, LLMModelSettings> | undefined = service.models;
		for (const [modelId, model] of Object.entries(models ?? {})) {
			options.push({
				value: modelId,
				label: formatLLMModelLabel(service.name, model.name),
			});
		}
	}
	return options;
}

export function selectServicesByType<TType extends ServiceSettings["type"]>(
	services: Record<string, ServiceSettings>,
	type: TType,
): Record<string, ServiceByType<TType>> {
	const subset: Record<string, ServiceByType<TType>> = {};
	Object.entries(services).forEach(([id, service]) => {
		if (service.type === type) {
			subset[id] = service as ServiceByType<TType>;
		}
	});
	return subset;
}

export function replaceServicesOfType<TType extends ServiceSettings["type"]>(
	services: Record<string, ServiceSettings>,
	type: TType,
	replacements: Record<string, ServiceByType<TType>>,
): Record<string, ServiceSettings> {
	const retained: Record<string, ServiceSettings> = {};
	Object.entries(services).forEach(([id, service]) => {
		if (service.type !== type) {
			retained[id] = service;
		}
	});
	return { ...retained, ...replacements };
}
