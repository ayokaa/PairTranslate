import { createQueueHub } from "~/utils/async/queue-hub";
import { PROMPT_ID, STORAGE_KEYS } from "~/utils/constants";
import {
	convertFromLLMError,
	convertFromTranslationError,
	createTranslateError,
	TranslateErrorType,
} from "~/utils/errors";
import type {
	StreamRunner,
	UnaryResult,
} from "~/utils/flow-control/model-queue";
import { computeCacheKey } from "~/utils/hasher";
import { areLanguagesSame } from "~/utils/language";
import { detectSourceLanguage } from "~/utils/language-detection";
import type {
	ChatRequest,
	ClientConfig,
	JSONSchema,
	LLMClient,
	LLMProvider,
} from "~/utils/llm";
import { createLLMClient } from "~/utils/llm";
import { appendReasoningContent } from "~/utils/llm/reasoning";
import {
	alignSegments,
	type DetailedSegment,
	type PromptStepOutput,
} from "~/utils/prompt/delimiter";
import {
	type CompiledPrompt,
	compilePrompt,
	initializeConversation,
	normalizeLLMStepOutput,
	normalizeLLMStepOutputDetailed,
	normalizePromptInput,
	normalizeStreamAggregate,
	snapshotConversation,
	toTextArray,
} from "~/utils/prompt/engine";
import {
	buildContextWithTranslateParams,
	tokensToString,
} from "~/utils/prompt/parser";
import type { TranslateOptions, TranslateService } from "~/utils/rpc";
import type { LLMModelSettings, ServiceSettings } from "~/utils/settings";
import { getSettings, listenSettings } from "~/utils/settings/helper";
import {
	findServiceForModelRef,
	type ResolvedLLMModel,
	resolveLLMModel,
} from "~/utils/settings/services";
import { createLRUStorage } from "~/utils/storage";
import { estimateTokens } from "~/utils/token-estimate";
import {
	translate as runTraditionalService,
	type TranslationConfig,
} from "~/utils/translate";
import {
	createTranslationResponse,
	shouldSkipSameLanguage,
	skippedForPayload,
	type TranslationResponse,
} from "~/utils/translation-result";
import { recordTranslationStats } from "~/utils/translation-stats";
import type { TranslateContext } from "~/utils/types";

const SINGLE_TEXT_SERVICES = new Set(["deeplx", "browser"]);

type TranslatePayload = string | string[];

type ThinCacheKey = Awaited<ReturnType<typeof computeCacheKey>>;

type ThinCacheState = {
	keys: ThinCacheKey[];
	values: (string | undefined)[];
	missing: number[];
};

type CachedValue<T = unknown> = {
	output: T;
	reasoning?: string;
};

const payloadChars = (payload: TranslatePayload): number =>
	Array.isArray(payload)
		? payload.reduce((sum, entry) => sum + entry.length, 0)
		: payload.length;

/**
 * How many translations one cache entry covers.
 *
 * A thin-cache entry holds a single segment, but a whole-batch or streamed
 * entry can hold an array; counting entries instead of requests keeps the
 * hit rate meaningful.
 */
const savedEntryCount = (output: unknown): number =>
	Array.isArray(output) ? output.length : 1;

const toStreamChunk = (value: unknown): string => {
	if (typeof value === "string") {
		return value;
	}
	if (value === undefined || value === null) {
		return "";
	}
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
};

const buildLLMClient = (
	provider: LLMProvider,
	config: ClientConfig,
): LLMClient => {
	switch (provider) {
		case "openai":
			return createLLMClient("openai", config);
		case "anthropic":
			return createLLMClient("anthropic", config);
		case "google":
			return createLLMClient("google", config);
		default:
			throw new Error(`Unsupported LLM provider: ${provider}`);
	}
};

const isStructuredOutput = (
	output: PromptStepOutput,
): output is { type: "structured"; schema: object } =>
	typeof output === "object" &&
	output !== null &&
	"type" in output &&
	output.type === "structured";

const createChatRequest = (
	model: LLMModelSettings,
	messages: ChatRequest["messages"],
	overrides?: Partial<Pick<ChatRequest, "stream">>,
): ChatRequest => ({
	model: model.name,
	messages,
	temperature: model.temperature,
	maxTokens: model.maxOutputTokens,
	thinkingBudget: model.thinkingBudget,
	extraBody: model.extraBody,
	...overrides,
});

export const createTranslateService = async (): Promise<TranslateService> => {
	let settings = await getSettings();
	if (!settings) {
		throw new Error("Settings not initialized");
	}

	const promptCache = new Map<string, CompiledPrompt>();
	const clientCache = new Map<string, LLMClient>();
	const resultCache = createLRUStorage<CachedValue>(
		"translate-cache",
		STORAGE_KEYS.cache,
		settings.queue.cacheSize,
	);

	const getCacheEntry = async (key: ArrayBuffer) => {
		if (settings.debug.disableCache) {
			return undefined;
		}
		return resultCache.get(key);
	};

	const setCacheEntry = async (key: ArrayBuffer, value: CachedValue) => {
		if (settings.debug.disableCache) {
			return;
		}
		await resultCache.set(key, value);
	};

	const applyDebugLatency = async () => {
		const latency = settings.debug.simulateLatencyMs;
		if (latency > 0) {
			await new Promise((resolve) => setTimeout(resolve, latency));
		}
	};

	const debugLog = (...args: unknown[]) => {
		if (!settings.debug.verboseLogging) {
			return;
		}
		console.info("[PairTranslate][Debug]", ...args);
	};

	const logGroup = (enabled: boolean, label: string, details: () => void) => {
		if (!enabled) return;
		console.groupCollapsed(label);
		try {
			details();
		} finally {
			console.groupEnd();
		}
	};

	const preview = (value: string, limit = 160) =>
		value.length > limit ? `${value.slice(0, limit)}…` : value;

	const traceLlms = (
		phase: "request" | "response",
		meta: Record<string, unknown>,
	) => {
		logGroup(
			settings.debug.traceLlms,
			`[LLM ${phase}] ${meta.model ?? meta.service ?? ""}`,
			() => {
				console.log(meta);
			},
		);
	};

	const traceTraditional = (
		phase: "request" | "response",
		meta: Record<string, unknown>,
	) => {
		logGroup(
			settings.debug.traceTraditional,
			`[Traditional ${phase}] ${meta.apiSpec ?? meta.service ?? ""}`,
			() => {
				console.log(meta);
			},
		);
	};

	const findService = (modelId: string): ServiceSettings | undefined =>
		findServiceForModelRef(settings.services, modelId);

	const resolveService = (modelId: string): ServiceSettings => {
		const service = findService(modelId);
		if (!service) {
			throw createTranslateError(
				TranslateErrorType.MODEL_NOT_FOUND,
				`Model ${modelId} not found. Please check your settings.`,
			);
		}
		return service;
	};

	type ServiceTarget =
		| {
				kind: "traditional";
				service: Extract<ServiceSettings, { type: "traditional" }>;
		  }
		| ({ kind: "llm" } & ResolvedLLMModel);

	// modelId may be a traditional service UUID or an LLM model UUID.
	const resolveTarget = (modelId: string): ServiceTarget => {
		const direct = settings.services[modelId];
		if (direct?.type === "traditional") {
			return { kind: "traditional", service: direct };
		}
		const resolved = resolveLLMModel(settings.services, modelId);
		if (resolved) {
			return { kind: "llm", ...resolved };
		}
		throw createTranslateError(
			TranslateErrorType.MODEL_NOT_FOUND,
			`Model ${modelId} not found. Please check your settings.`,
		);
	};

	const getPrompt = (promptId: string): CompiledPrompt => {
		const cached = promptCache.get(promptId);
		if (cached) return cached;
		const prompt = settings.prompts[promptId];
		if (!prompt) {
			throw createTranslateError(
				TranslateErrorType.INVALID_PROMPT,
				`Prompt ${promptId} not found. Please check your settings.`,
			);
		}
		const compiled = compilePrompt(prompt);
		promptCache.set(promptId, compiled);
		return compiled;
	};

	const getQueueConfig = (modelId: string) => {
		const base = settings.queue;
		const override = findService(modelId)?.queue;
		return {
			requestConcurrency:
				override?.requestConcurrency ?? base.requestConcurrency,
			tokensPerMinute: override?.tokensPerMinute ?? base.tokensPerMinute,
		};
	};

	const ensureLLMClient = (
		serviceId: string,
		service: Extract<ServiceSettings, { type: "llm" }>,
	): LLMClient => {
		const cached = clientCache.get(serviceId);
		if (cached) return cached;
		const baseUrl = service.baseUrl;
		const client = buildLLMClient(service.apiSpec, {
			apiKey: service.apiKey,
			baseUrl,
		});
		clientCache.set(serviceId, client);
		return client;
	};

	const queueHub = createQueueHub((modelId: string) => {
		const config = getQueueConfig(modelId);
		return {
			requestConcurrency: config.requestConcurrency,
			tokensPerMinute: config.tokensPerMinute,
		};
	});

	listenSettings((next) => {
		settings = next;
		promptCache.clear();
		clientCache.clear();
		queueHub.refresh();
		resultCache.resize(next.queue.cacheSize);
	});

	const runTraditional = async (
		service: Extract<ServiceSettings, { type: "traditional" }>,
		texts: string[],
		srcLang: string,
		dstLang: string,
		signal?: AbortSignal,
	): Promise<{ result: string[]; tokens: number }> => {
		const runOnce = async (texts: string[]) => {
			try {
				const response = await runTraditionalService(
					service.apiSpec,
					service as TranslationConfig,
					{
						text: texts,
						sourceLang: srcLang,
						targetLang: dstLang,
						signal,
					},
				);
				return response;
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") {
					throw error;
				}
				throw convertFromTranslationError(error);
			}
		};

		traceTraditional("request", {
			service: service.name,
			apiSpec: service.apiSpec,
			texts: texts.length,
			characters: texts.reduce((sum, entry) => sum + entry.length, 0),
			srcLang,
			dstLang,
		});

		const tokenEstimate = estimateTokens(texts);
		let result: string[];
		if (SINGLE_TEXT_SERVICES.has(service.apiSpec)) {
			const translated: string[] = [];
			for (const text of texts) {
				const response = await runOnce([text]);
				translated.push(response.translatedText[0]);
			}
			result = translated;
		} else {
			const response = await runOnce(texts);
			result = response.translatedText;
		}
		traceTraditional("response", {
			service: service.name,
			apiSpec: service.apiSpec,
			items: result.length,
			tokens: tokenEstimate,
		});
		recordTranslationStats({
			traditionalRequests: 1,
			chars: payloadChars(texts),
		});
		return { result, tokens: tokenEstimate };
	};

	const runTraditionalStream = (
		service: Extract<ServiceSettings, { type: "traditional" }>,
		payload: TranslatePayload,
		srcLang: string,
		dstLang: string,
		onResult: (value: string[]) => void,
		signal?: AbortSignal,
	): StreamRunner => {
		return async () => {
			await applyDebugLatency();
			signal?.throwIfAborted();

			const texts = toTextArray(payload);
			if (texts.length === 0) {
				onResult([]);
				return {
					iterator: (async function* () {
						yield { content: "" };
					})(),
					completion: Promise.resolve(0),
				};
			}
			const { result, tokens } = await runTraditional(
				service,
				texts,
				srcLang,
				dstLang,
				signal,
			);
			onResult(result);
			const combined = result.join("\n");
			return {
				iterator: (async function* () {
					yield { content: combined };
				})(),
				completion: Promise.resolve(tokens),
			};
		};
	};

	const runLLMSteps = async (
		target: ResolvedLLMModel,
		prompt: CompiledPrompt,
		textPayload: TranslatePayload,
		ctx: TranslateContext,
		srcLang: string,
		dstLang: string,
		promptId: string,
		signal?: AbortSignal,
	): Promise<{
		result: unknown;
		tokens: number;
		reasoning?: string;
		outputIndices?: (number | undefined)[];
	}> => {
		const { serviceId, service, model } = target;
		const client = ensureLLMClient(serviceId, service);
		const promptCtx = buildContextWithTranslateParams(
			ctx,
			{ src: srcLang, dst: dstLang },
			textPayload,
		);
		const outputs: unknown[] = [];
		promptCtx.output = outputs;
		const conversation = initializeConversation(prompt, promptCtx);
		const usage = {
			promptTokens: 0,
			completionTokens: 0,
			totalTokens: 0,
			cachedTokens: 0,
		};
		let reasoning: string | undefined;
		let outputIndices: (number | undefined)[] | undefined;
		let stepIndex = 0;
		for (const step of prompt.steps) {
			stepIndex += 1;
			conversation.push({
				role: "user",
				content: tokensToString(promptCtx, step.messageTokens),
			});
			const request = createChatRequest(
				model,
				snapshotConversation(conversation),
			);
			const latestMessage = conversation.at(-1);
			traceLlms("request", {
				service: service.name,
				model: model.name,
				step: stepIndex,
				stream: false,
				snippet:
					typeof latestMessage?.content === "string"
						? preview(latestMessage.content)
						: undefined,
			});
			try {
				const schema = isStructuredOutput(step.output)
					? (step.output.schema as JSONSchema)
					: undefined;
				const response = await client.chat(request, schema, signal);
				usage.promptTokens += response.usage?.promptTokens ?? 0;
				usage.completionTokens += response.usage?.completionTokens ?? 0;
				usage.totalTokens +=
					response.usage?.totalTokens ?? response.usage?.promptTokens ?? 0;
				usage.cachedTokens += response.usage?.cachedTokens ?? 0;
				reasoning = appendReasoningContent(reasoning, response.reasoning);
				const detailed = normalizeLLMStepOutputDetailed(step, response.output);
				const output = detailed
					? detailed.texts
					: normalizeLLMStepOutput(step, response.output);
				outputIndices = detailed?.indices;
				outputs.push(output);
				conversation.push({
					role: "assistant",
					content: response.content ?? toStreamChunk(output),
				});
				traceLlms("response", {
					service: service.name,
					model: model.name,
					step: stepIndex,
					stream: false,
					snippet:
						typeof output === "string"
							? preview(output)
							: Array.isArray(output)
								? `array(${output.length})`
								: typeof output,
					tokens:
						response.usage?.totalTokens ??
						response.usage?.completionTokens ??
						response.usage?.promptTokens ??
						0,
				});
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") {
					throw error;
				}
				throw convertFromLLMError(error);
			}
		}
		recordTranslationStats({
			llmRequests: 1,
			promptTokens: usage.promptTokens,
			completionTokens: usage.completionTokens,
			totalTokens: usage.totalTokens,
			cachedTokens: usage.cachedTokens,
			webAdaptationPromptTokens:
				promptId === PROMPT_ID.webAdaptation ? usage.promptTokens : 0,
			webAdaptationCompletionTokens:
				promptId === PROMPT_ID.webAdaptation ? usage.completionTokens : 0,
			webAdaptationTotalTokens:
				promptId === PROMPT_ID.webAdaptation ? usage.totalTokens : 0,
			chars: payloadChars(textPayload),
		});
		return {
			result: outputs.at(-1),
			tokens: usage.totalTokens,
			reasoning,
			outputIndices,
		};
	};

	const runLLMStream = (
		target: ResolvedLLMModel,
		prompt: CompiledPrompt,
		textPayload: TranslatePayload,
		ctx: TranslateContext,
		srcLang: string,
		dstLang: string,
		signal?: AbortSignal,
	): StreamRunner => {
		return async () => {
			await applyDebugLatency();
			signal?.throwIfAborted();

			const { serviceId, service, model } = target;
			const client = ensureLLMClient(serviceId, service);
			const promptCtx = buildContextWithTranslateParams(
				ctx,
				{ src: srcLang, dst: dstLang },
				textPayload,
			);
			const outputs: unknown[] = [];
			promptCtx.output = outputs;
			const conversation = initializeConversation(prompt, promptCtx);
			const usage = {
				promptTokens: 0,
				completionTokens: 0,
				totalTokens: 0,
				cachedTokens: 0,
			};
			const lastIndex = prompt.steps.length - 1;
			for (let index = 0; index < lastIndex; index++) {
				const step = prompt.steps[index];
				conversation.push({
					role: "user",
					content: tokensToString(promptCtx, step.messageTokens),
				});
				const request = createChatRequest(
					service,
					snapshotConversation(conversation),
				);
				const latestMessage = conversation.at(-1);
				traceLlms("request", {
					service: service.name,
					model: model.name,
					step: index + 1,
					stream: false,
					snippet:
						typeof latestMessage?.content === "string"
							? preview(latestMessage.content)
							: undefined,
				});
				try {
					const schema = isStructuredOutput(step.output)
						? (step.output.schema as JSONSchema)
						: undefined;
					const response = await client.chat(request, schema, signal);
					usage.promptTokens += response.usage?.promptTokens ?? 0;
					usage.completionTokens += response.usage?.completionTokens ?? 0;
					usage.totalTokens +=
						response.usage?.totalTokens ?? response.usage?.promptTokens ?? 0;
					usage.cachedTokens += response.usage?.cachedTokens ?? 0;
					const output = normalizeLLMStepOutput(step, response.output);
					outputs.push(output);
					conversation.push({
						role: "assistant",
						content: response.content ?? toStreamChunk(output),
					});
					traceLlms("response", {
						service: service.name,
						model: model.name,
						step: index + 1,
						stream: false,
						snippet:
							typeof output === "string"
								? preview(output)
								: Array.isArray(output)
									? `array(${output.length})`
									: typeof output,
					});
				} catch (error) {
					if (error instanceof Error && error.name === "AbortError") {
						throw error;
					}
					throw convertFromLLMError(error);
				}
			}
			const finalStep = prompt.steps.at(-1);
			if (!finalStep) {
				throw createTranslateError(
					TranslateErrorType.VALIDATION_ERROR,
					"No steps available in the prompt. This should not happen.",
				);
			}
			conversation.push({
				role: "user",
				content: tokensToString(promptCtx, finalStep.messageTokens),
			});
			const request = createChatRequest(
				model,
				snapshotConversation(conversation),
				{ stream: true },
			);
			const latestPrompt = conversation.at(-1);
			traceLlms("request", {
				service: service.name,
				model: model.name,
				step: prompt.steps.length,
				stream: true,
				snippet:
					typeof latestPrompt?.content === "string"
						? preview(latestPrompt.content)
						: undefined,
			});

			const { promise: completion, resolve: resolveCompletion } =
				Promise.withResolvers<number>();
			const source = client.chatStream(request, undefined, signal);
			return {
				iterator: (async function* () {
					try {
						while (true) {
							const next = await source.next();
							if (next.done) {
								if (next.value?.reasoning) {
									yield { reasoning: next.value.reasoning };
								}
								traceLlms("response", {
									service: service.name,
									model: model.name,
									stream: true,
									tokens: next.value?.usage?.completionTokens ?? 0,
									reasoningChars: next.value?.reasoning?.length ?? 0,
								});
								usage.promptTokens += next.value?.usage?.promptTokens ?? 0;
								usage.completionTokens +=
									next.value?.usage?.completionTokens ?? 0;
								usage.totalTokens +=
									next.value?.usage?.totalTokens ??
									next.value?.usage?.promptTokens ??
									0;
								usage.cachedTokens += next.value?.usage?.cachedTokens ?? 0;
								recordTranslationStats({
									llmRequests: 1,
									promptTokens: usage.promptTokens,
									completionTokens: usage.completionTokens,
									totalTokens: usage.totalTokens,
									cachedTokens: usage.cachedTokens,
									chars: payloadChars(textPayload),
								});
								resolveCompletion(next.value?.usage?.completionTokens ?? 0);
								return;
							}
							const chunk = next.value;
							if (chunk?.content || chunk?.reasoning) {
								yield chunk;
							}
						}
					} finally {
						await source.return({});
						resolveCompletion(0);
					}
				})(),
				completion,
			};
		};
	};

	/**
	 * Resolve the effective source language when srcLang is "auto".
	 * Uses a fast local detector to identify the language; if detection
	 * is unavailable or the result equals the target language, returns
	 * skip=true so the caller can short-circuit. Summaries are exempt:
	 * the same language can still be summarized.
	 */
	const resolveAutoSrcLang = async (
		text: string,
		srcLang: string,
		dstLang: string,
		promptId: string,
	): Promise<{ srcLang: string; skip: boolean }> => {
		if (srcLang !== "auto") return { srcLang, skip: false };
		const detected = await detectSourceLanguage(text);
		if (!detected) return { srcLang: "auto", skip: false };
		if (
			shouldSkipSameLanguage(promptId) &&
			areLanguagesSame(detected, dstLang)
		) {
			return { srcLang: detected, skip: true };
		}
		return { srcLang: detected, skip: false };
	};

	/**
	 * A batch that was detected as same-language and must not be translated.
	 */
	type SkippedUnary = {
		skip: true;
		payload: TranslatePayload;
	};

	/**
	 * A unary request whose target, source language and cache contents are
	 * already resolved.
	 *
	 * Split out of `executeUnary` so `unary()` can read the cache *before*
	 * entering the model queue. A cache hit spends no tokens and no concurrency,
	 * so making it buy either from the queue is what stalls a page that has
	 * already been translated. Both shapes share these helpers, so the cache keys
	 * are computed in exactly one place.
	 */
	type ResolvedUnary = {
		skip?: undefined;
		payload: TranslatePayload;
		target: ServiceTarget;
		compiled: CompiledPrompt | undefined;
		expectsArray: boolean;
		payloadArray: string[] | undefined;
		supportsThinCache: boolean;
		effectiveSrcLang: string;
		cacheKey: ArrayBuffer;
		thinCacheState: ThinCacheState | undefined;
		/** The whole-batch entry, for requests that do not use the thin cache. */
		cached: CachedValue | undefined;
	};

	type PreparedUnary = SkippedUnary | ResolvedUnary;

	const prepareUnary = async (
		ctx: TranslateContext,
		options: TranslateOptions,
		text: string | string[] | undefined,
	): Promise<PreparedUnary> => {
		const modelId = options.modelId;
		const promptId = options.promptId;
		if (!promptId) {
			throw createTranslateError(
				TranslateErrorType.INVALID_PROMPT,
				"Prompt ID is required",
			);
		}
		const target = resolveTarget(modelId);
		const payload = text ?? "";
		const expectsArray = Array.isArray(payload);
		const compiled = target.kind === "llm" ? getPrompt(promptId) : undefined;
		const payloadArray = Array.isArray(payload) ? payload : undefined;
		const supportsThinCache =
			Boolean(options.thinCache) &&
			!!payloadArray &&
			(target.kind === "traditional" ||
				(target.kind === "llm" && compiled?.input === "stringArray"));

		let effectiveSrcLang = options.srcLang;
		if (effectiveSrcLang === "auto") {
			// Sample the whole batch, not just its first segment. A 20-50 character
			// headline is a coin flip for the n-gram detector (a batch of real HN
			// titles had one entry detected as Polish and another only correct at
			// 0.08 confidence), while the same text joined with its batchmates
			// carries hundreds of characters of signal and was right every time.
			// The detector is local and costs ~0.3ms for 500 characters, which is
			// noise next to an LLM round trip, so this is free.
			const sample = Array.isArray(payload)
				? payload
						.filter((entry) => entry.length > 0)
						.join(" ")
						.slice(0, 512)
				: payload;
			if (typeof sample === "string" && sample.length > 0) {
				const resolved = await resolveAutoSrcLang(
					sample,
					options.srcLang,
					options.dstLang,
					promptId,
				);
				if (resolved.skip) {
					return {
						skip: true,
						payload,
					};
				}
				if (target.kind === "llm") {
					effectiveSrcLang = resolved.srcLang;
				}
			}
		}

		const cacheKey = await computeCacheKey(
			promptId,
			modelId,
			text,
			ctx,
			effectiveSrcLang,
			options.dstLang,
		);
		let thinCacheState: ThinCacheState | undefined;
		let cached: CachedValue | undefined;

		debugLog("unary/start", {
			modelId,
			promptId,
			payloadType: Array.isArray(text) ? "array" : typeof text,
			payloadSize: Array.isArray(text)
				? text.length
				: typeof text === "string"
					? text.length
					: 0,
		});

		if (supportsThinCache && payloadArray) {
			const entryKeys = await Promise.all(
				payloadArray.map((entry) =>
					computeCacheKey(
						promptId,
						modelId,
						entry,
						ctx,
						effectiveSrcLang,
						options.dstLang,
					),
				),
			);
			const cacheState: ThinCacheState = {
				keys: entryKeys,
				values: new Array(payloadArray.length),
				missing: [],
			};
			thinCacheState = cacheState;
			if (options.cleanCache) {
				await Promise.all(entryKeys.map((key) => resultCache.del(key)));
				cacheState.missing = payloadArray.map((_, index) => index);
			} else {
				const cachedEntries = await Promise.all(
					entryKeys.map((key) => getCacheEntry(key)),
				);
				let hitEntries = 0;
				let hitChars = 0;
				cachedEntries.forEach((entry, index) => {
					if (entry && typeof entry.output === "string") {
						cacheState.values[index] = entry.output;
						hitEntries++;
						hitChars += payloadChars(payloadArray[index]);
					} else {
						cacheState.missing.push(index);
					}
				});
				// Count the hit per entry, not per batch: a batch where 12 of 13
				// segments came from the cache saved 12 translations, and the
				// statistics have to say so — otherwise a partly cached page
				// reports zero hits and the hit rate looks far worse than it is.
				if (hitEntries > 0) {
					recordTranslationStats({ cacheHits: hitEntries, chars: hitChars });
				}
			}
		} else if (!options.cleanCache) {
			cached = await getCacheEntry(cacheKey);
		} else {
			await resultCache.del(cacheKey);
		}

		return {
			skip: undefined,
			payload,
			target,
			compiled,
			expectsArray,
			payloadArray,
			supportsThinCache,
			effectiveSrcLang,
			cacheKey,
			thinCacheState,
			cached,
		};
	};

	/**
	 * The response for a batch that is entirely cached, or undefined when any
	 * position still has to be translated. Reads nothing — everything comes from
	 * the prepared request — so a hit needs no quota from the model queue.
	 */
	const cachedUnaryResponse = async (
		options: TranslateOptions,
		state: ResolvedUnary,
	): Promise<TranslationResponse<unknown> | undefined> => {
		const { payload, thinCacheState, cached } = state;
		const promptId = options.promptId;
		if (thinCacheState) {
			if (thinCacheState.missing.length > 0) return undefined;
			const cachedValues = thinCacheState.values.slice() as string[];
			await applyDebugLatency();
			debugLog("unary/cache-hit", {
				modelId: options.modelId,
				promptId,
				type: "thin",
				entries: cachedValues.length,
			});
			return createTranslationResponse(payload, cachedValues, promptId);
		}
		if (!cached) return undefined;
		await applyDebugLatency();
		debugLog("unary/cache-hit", {
			modelId: options.modelId,
			promptId,
			type: "full",
		});
		recordTranslationStats({
			cacheHits: savedEntryCount(cached.output),
			chars: payloadChars(payload),
		});
		return createTranslationResponse(payload, cached.output, promptId, {
			reasoning: cached.reasoning,
		});
	};

	const skippedUnaryResponse = (
		payload: TranslatePayload,
		promptId: string,
	): TranslationResponse<unknown> =>
		createTranslationResponse(
			payload,
			Array.isArray(payload) ? payload.map(() => "") : "",
			promptId,
			{ skipped: skippedForPayload(payload) },
		);

	const executeUnary = async (
		ctx: TranslateContext,
		options: TranslateOptions,
		text: string | string[] | undefined,
		signal?: AbortSignal,
		/** Reuse a cache state the caller already read, instead of reading it again. */
		prepared?: PreparedUnary,
		// biome-ignore lint/suspicious/noExplicitAny: result can be any type
	): Promise<UnaryResult<any>> => {
		const promptId = options.promptId;
		if (!promptId) {
			throw createTranslateError(
				TranslateErrorType.INVALID_PROMPT,
				"Prompt ID is required",
			);
		}
		const state = prepared ?? (await prepareUnary(ctx, options, text));
		if (state.skip) {
			return {
				value: skippedUnaryResponse(state.payload, promptId),
				completionTokens: 0,
			};
		}
		// Only reachable for a prepared request that was partly cached: the
		// values already read are reused, the missing ones are translated below.
		const served = await cachedUnaryResponse(options, state);
		if (served) {
			return { value: served, completionTokens: 0 };
		}

		const modelId = options.modelId;
		const {
			target,
			compiled,
			payload,
			expectsArray,
			payloadArray,
			supportsThinCache,
			effectiveSrcLang,
			cacheKey,
			thinCacheState,
		} = state;

		const executionPayload =
			thinCacheState && payloadArray
				? thinCacheState.missing.map((index) => payloadArray[index])
				: payload;
		const normalizedPayload =
			target.kind === "llm" && compiled
				? normalizePromptInput(compiled, executionPayload)
				: Array.isArray(executionPayload)
					? executionPayload
					: executionPayload;
		let translationResult: unknown;
		let completionTokens = 0;
		let reasoning: string | undefined;
		let outputIndices: (number | undefined)[] | undefined;

		if (target.kind === "traditional") {
			const texts = toTextArray(
				Array.isArray(normalizedPayload)
					? normalizedPayload
					: [normalizedPayload],
			);
			if (texts.length === 0) {
				return {
					value: createTranslationResponse(
						payload,
						expectsArray ? [] : "",
						promptId,
					),
					completionTokens: 0,
				};
			}
			const traditionalResult = await runTraditional(
				target.service,
				texts,
				effectiveSrcLang,
				options.dstLang,
				signal,
			);
			translationResult = traditionalResult.result;
			completionTokens = traditionalResult.tokens;
		} else {
			const compiledPrompt = compiled ?? getPrompt(promptId);
			const llmResult = await runLLMSteps(
				target,
				compiledPrompt,
				normalizedPayload,
				ctx,
				effectiveSrcLang,
				options.dstLang,
				promptId,
				signal,
			);
			translationResult = llmResult.result;
			completionTokens = llmResult.tokens;
			reasoning = llmResult.reasoning;
			outputIndices = llmResult.outputIndices;
		}

		let finalValue = translationResult;
		const toSegments = (
			texts: unknown[],
			indices?: (number | undefined)[],
		): DetailedSegment[] =>
			texts.map((text, i) => ({ text: String(text), index: indices?.[i] }));
		if (thinCacheState && payloadArray) {
			if (!Array.isArray(translationResult)) {
				throw createTranslateError(
					TranslateErrorType.VALIDATION_ERROR,
					"Thin cache requires translation results to be arrays.",
				);
			}
			const executionItems = Array.isArray(executionPayload)
				? executionPayload
				: [executionPayload];
			const expected = thinCacheState.missing.length;
			let { values, missing } = alignSegments(
				toSegments(translationResult, outputIndices),
				expected,
			);
			if (missing.length > 0) {
				// One recovery round: re-request only the positions that failed to
				// align, then map the sub-batch back onto the original positions.
				debugLog("unary/recover", {
					modelId,
					promptId,
					expected,
					received: expected - missing.length,
				});
				const retryItems = missing.map((pos) => executionItems[pos]);
				let retryResult: unknown;
				let retryIndices: (number | undefined)[] | undefined;
				if (target.kind === "traditional") {
					const retried = await runTraditional(
						target.service,
						retryItems,
						effectiveSrcLang,
						options.dstLang,
						signal,
					);
					retryResult = retried.result;
					completionTokens += retried.tokens;
				} else {
					const retried = await runLLMSteps(
						target,
						compiled ?? getPrompt(promptId),
						compiled ? normalizePromptInput(compiled, retryItems) : retryItems,
						ctx,
						effectiveSrcLang,
						options.dstLang,
						promptId,
						signal,
					);
					retryResult = retried.result;
					retryIndices = retried.outputIndices;
					completionTokens += retried.tokens;
					reasoning = appendReasoningContent(reasoning, retried.reasoning);
				}
				if (Array.isArray(retryResult)) {
					const sub = alignSegments(
						toSegments(retryResult, retryIndices),
						retryItems.length,
					);
					sub.values.forEach((value, subPos) => {
						if (value !== undefined) values[missing[subPos]] = value;
					});
					missing = missing.filter(
						(_, subPos) => sub.values[subPos] === undefined,
					);
				}
			}
			// Cache every aligned entry, even when some positions are still
			// missing: the next retry then only re-requests those positions
			// instead of the whole batch.
			await Promise.all(
				thinCacheState.missing.map((origIndex, pos) => {
					const value = values[pos];
					return value === undefined
						? Promise.resolve()
						: setCacheEntry(thinCacheState.keys[origIndex], { output: value });
				}),
			);
			if (missing.length > 0) {
				throw createTranslateError(
					TranslateErrorType.VALIDATION_ERROR,
					`Expected ${expected} translations, but got ${expected - missing.length}`,
				);
			}
			const merged = thinCacheState.values.slice();
			thinCacheState.missing.forEach((origIndex, pos) => {
				merged[origIndex] = values[pos] as string;
			});
			finalValue = merged;
		} else if (
			payloadArray &&
			Array.isArray(translationResult) &&
			outputIndices
		) {
			// No thin cache: only swap in the aligned result when every position
			// resolved; otherwise keep the raw result and let the caller's
			// length check report the tail as errors.
			const aligned = alignSegments(
				toSegments(translationResult, outputIndices),
				payloadArray.length,
			);
			if (aligned.missing.length === 0) finalValue = aligned.values;
		}

		if (!supportsThinCache) {
			await setCacheEntry(cacheKey, {
				output: finalValue,
				reasoning,
			});
		}
		await applyDebugLatency();
		debugLog("unary/complete", {
			modelId,
			promptId,
			stream: false,
			completionTokens,
			reasoning: Boolean(reasoning),
		});
		return {
			value: createTranslationResponse(payload, finalValue, promptId, {
				reasoning,
			}),
			completionTokens,
		};
	};

	return {
		async unary(
			ctx: TranslateContext,
			options: TranslateOptions,
			text?: string | string[],
			_meta?: unknown,
			signal?: AbortSignal,
		) {
			const payload = text ?? "";

			// Read the cache before entering the model queue. A hit spends no tokens
			// and no concurrency, so it must not have to buy either: otherwise a page
			// that is already translated waits for the rate limiter to refill before
			// anything renders — seconds, once a page of real requests has spent the
			// bucket. `stream()` has always short-circuited here; unary now does the
			// same. `cleanCache` is a forced re-translation, so it skips the lookup
			// (and its deletes) entirely and always goes through the queue.
			const prepared = options.cleanCache
				? undefined
				: await prepareUnary(ctx, options, payload);
			if (prepared) {
				if (prepared.skip) {
					return skippedUnaryResponse(prepared.payload, options.promptId);
				}
				const served = await cachedUnaryResponse(options, prepared);
				if (served) return served;
			}

			const target = resolveTarget(options.modelId);
			const prompt =
				target.kind === "llm" ? getPrompt(options.promptId) : undefined;
			const normalized = prompt
				? normalizePromptInput(prompt, payload)
				: (payload ?? "");
			const estimated = estimateTokens(normalized);
			const queue = queueHub.queue(options.modelId);
			return queue.enqueueUnary(
				() => executeUnary(ctx, options, payload, signal, prepared),
				estimated,
			);
		},
		stream(
			ctx: TranslateContext,
			options: TranslateOptions,
			text?: string | string[],
			_meta?: unknown,
			signal?: AbortSignal,
		) {
			const modelId = options.modelId;
			const promptId = options.promptId;
			const target = resolveTarget(modelId);
			const payload = text ?? "";
			const compiledPrompt =
				target.kind === "llm" ? getPrompt(promptId) : undefined;
			const normalized =
				target.kind === "llm" && compiledPrompt
					? normalizePromptInput(compiledPrompt, payload)
					: payload;

			debugLog("stream/start", {
				modelId,
				promptId,
				cleanCache: Boolean(options.cleanCache),
			});
			return (async function* () {
				let effectiveSrcLang = options.srcLang;
				if (effectiveSrcLang === "auto") {
					const sample = Array.isArray(payload)
						? (payload.find((entry) => entry.length > 0) ?? "")
						: payload;
					if (typeof sample === "string" && sample.length > 0) {
						const resolved = await resolveAutoSrcLang(
							sample,
							options.srcLang,
							options.dstLang,
							promptId,
						);
						if (resolved.skip) {
							yield { content: "", skipped: true };
							return;
						}
						if (target.kind === "llm") {
							effectiveSrcLang = resolved.srcLang;
						}
					}
				}
				// Argument order must match `computeCacheKey(promptId, modelId, ...)`
				// so stream results share keys with the unary/thin-cache paths.
				const cacheKey = await computeCacheKey(
					promptId,
					modelId,
					text,
					ctx,
					effectiveSrcLang,
					options.dstLang,
				);
				if (options.cleanCache) {
					await resultCache.del(cacheKey);
				} else {
					const cached = await getCacheEntry(cacheKey);
					const cachedValue = cached?.output;
					if (cachedValue !== undefined) {
						await applyDebugLatency();
						debugLog("stream/cache-hit", {
							modelId,
							promptId,
						});
						recordTranslationStats({
							cacheHits: savedEntryCount(cachedValue),
							chars: payloadChars(payload),
						});
						yield {
							content:
								typeof cachedValue === "string"
									? cachedValue
									: toStreamChunk(cachedValue),
						};
						if (cached?.reasoning) {
							yield { reasoning: cached.reasoning };
						}
						return;
					}
				}
				const queue = queueHub.queue(modelId);
				const estimated = estimateTokens(normalized);
				const finalStep = compiledPrompt?.steps.at(-1);
				let traditionalResult: string[] | undefined;
				const streamRunner =
					target.kind === "llm"
						? runLLMStream(
								target,
								compiledPrompt ?? getPrompt(promptId),
								normalized,
								ctx,
								effectiveSrcLang,
								options.dstLang,
								signal,
							)
						: runTraditionalStream(
								target.service,
								normalized,
								effectiveSrcLang,
								options.dstLang,
								(result) => {
									traditionalResult = result;
								},
								signal,
							);
				const iterator = await queue.enqueueStream(streamRunner, estimated);
				let translationAggregate = "";
				let reasoningAggregate = "";
				try {
					for await (const chunk of iterator) {
						if (!chunk) continue;
						if (chunk.content) {
							translationAggregate += chunk.content;
						}
						if (chunk.reasoning) {
							reasoningAggregate += chunk.reasoning;
						}
						yield chunk;
					}
					if (target.kind === "llm") {
						const normalizedOutput = normalizeStreamAggregate(
							finalStep,
							translationAggregate,
						);
						await setCacheEntry(cacheKey, {
							output: normalizedOutput,
							reasoning: reasoningAggregate || undefined,
						});
					} else if (traditionalResult) {
						await setCacheEntry(cacheKey, {
							output: Array.isArray(payload)
								? traditionalResult
								: traditionalResult[0],
						});
					}
					debugLog("stream/complete", {
						modelId,
						promptId,
						aggregatedSize: translationAggregate.length,
						reasoningSize: reasoningAggregate.length,
					});
				} finally {
					if (signal?.aborted) {
						// @ts-expect-error This is fine, since no one is using the value.
						await iterator.return();
					}
				}
			})();
		},
		async clearCache() {
			await resultCache.clear();
		},
		async cacheStats() {
			return resultCache.stats();
		},
		queueStatus(modelId: string) {
			resolveService(modelId);
			return queueHub.subscribe(modelId);
		},
	};
};
