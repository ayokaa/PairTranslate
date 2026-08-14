import type { LLMModelSettings, ServiceSettings } from "~/utils/settings";

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
		const model = service.models[modelId];
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
		for (const [modelId, model] of Object.entries(service.models)) {
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
