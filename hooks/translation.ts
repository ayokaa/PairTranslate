import {
	batch,
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	untrack,
} from "solid-js";
import { createStore } from "solid-js/store";
import {
	convertGenericError,
	createTranslateError,
	type TranslateError,
	TranslateErrorType,
} from "~/utils/errors";
import { t } from "~/utils/i18n";
import { areLanguagesSame } from "~/utils/language";
import { detectSourceLanguage } from "~/utils/language-detection";
import { createThinkingFilter } from "~/utils/llm/thinking-filter";
import {
	shouldSkipSameLanguage,
	type TranslationResponse,
	type TranslationSkipped,
	type TranslationStreamChunk,
} from "~/utils/translation-result";
import type { TranslateContext } from "~/utils/types";
import { mightUseProgressIndicator } from "./progress-indicator";

const detectAndSkip = async (
	text: string,
	srcLang: string | undefined,
	dstLang: string,
	promptId: string,
): Promise<boolean> => {
	if (!shouldSkipSameLanguage(promptId)) return false;
	const currentSrc = srcLang || "auto";
	if (currentSrc !== "auto") return areLanguagesSame(currentSrc, dstLang);
	const detected = await detectSourceLanguage(text);
	if (!detected) return false;
	return areLanguagesSame(detected, dstLang);
};

// The sample the client and the background detect on, so both sides of the
// skip decision always reach the same conclusion: one short headline is a coin
// flip for the detector, the joined batch is not.
const detectionSample = (texts: string[]) =>
	texts
		.filter((text) => text.length > 0)
		.join(" ")
		.slice(0, 512);

type Pending = {
	(): undefined;
	loading: true;
	error: undefined;
	skipped: false;
};
type Skipped = {
	(): undefined;
	loading: false;
	error: undefined;
	skipped: true;
};
type Error = {
	(): undefined;
	loading: false;
	error: TranslateError;
	skipped: false;
};
type Success<T> = {
	(): T;
	loading: false;
	error: undefined;
	skipped: false;
};
type Result<T> = Pending | Skipped | Error | Success<T>;

type BatchReturn = readonly [
	() => Result<string>[],
	retry: (index?: number) => void,
];

type TranslateUnaryPayload<T> = T | TranslationResponse<T>;

const normalizeUnaryResponse = <T>(
	resp: TranslateUnaryPayload<T>,
): TranslationResponse<T> => {
	if (resp && typeof resp === "object" && "output" in resp) {
		const response = resp as TranslationResponse<T>;
		return {
			...response,
			skipped: response.skipped ?? false,
		};
	}
	return {
		output: resp as T,
		reasoning: undefined,
		skipped: false,
	};
};

const noModelError = () =>
	createTranslateError(
		TranslateErrorType.MODEL_NOT_FOUND,
		t("errors.translationModelRequired"),
	);
const batchMismatchError = (exp: number, got: number) =>
	createTranslateError(
		TranslateErrorType.VALIDATION_ERROR,
		`Expected ${exp} translations, but got ${got}`,
	);

export function createBatchTranslation(
	text: () => string[],
	options: {
		promptId: string;
		modelId: () => string | undefined;
		srcLang: () => string | undefined;
		dstLang: () => string;
		thinCache?: boolean;
		/** Prepare context only when the batch cannot be served from cache. */
		beforeTranslate?: () => Promise<unknown>;
		ctx?: () => Record<string, unknown>;
	},
): BatchReturn {
	const promptId = options.promptId;
	const modelId = options.modelId;
	const srcLang = options.srcLang;
	const dstLang = options.dstLang;
	const ctx = options.ctx || (() => ({}));
	const thinCache = options.thinCache ?? true;
	const progressCtx = mightUseProgressIndicator();

	const [textResult, setTextResult] = createStore<(string | undefined)[]>([]);
	const [error, setError] = createStore<(TranslateError | undefined)[]>([]);
	const [skipped, setSkipped] = createStore<boolean[]>([]);
	const pending = new Set<AbortController>();
	const cancelPending = () => {
		for (const controller of pending) controller.abort();
		pending.clear();
	};
	onCleanup(cancelPending);

	const normalizeSkipped = (
		value: TranslationSkipped,
		len: number,
	): boolean[] =>
		Array.isArray(value)
			? Array.from({ length: len }, (_, index) => value[index] === true)
			: Array.from({ length: len }, () => value === true);

	const setAllError = (e: TranslateError, len: number) =>
		batch(() => {
			setError({ to: len - 1 }, e);
			setTextResult({ to: len - 1 }, undefined);
			setSkipped(Array.from({ length: len }, () => false));
		});

	const setAllLoading = (len: number) =>
		batch(() => {
			setError({ to: len - 1 }, undefined);
			setTextResult({ to: len - 1 }, undefined);
			setSkipped(Array.from({ length: len }, () => false));
		});

	const setResultTexts = (
		texts: string[],
		skippedState: TranslationSkipped = false,
	) =>
		batch(() => {
			const skippedItems = normalizeSkipped(skippedState, texts.length);
			setError({ to: texts.length - 1 }, undefined);
			setTextResult(
				texts.map((text, index) => (skippedItems[index] ? undefined : text)),
			);
			setSkipped(skippedItems);
		});
	const setAllSkipped = (len: number) =>
		batch(() => {
			setError({ to: len - 1 }, undefined);
			setTextResult(Array.from({ length: len }, () => undefined));
			setSkipped(Array.from({ length: len }, () => true));
		});
	const clearAll = () =>
		batch(() => {
			setError([]);
			setTextResult([]);
			setSkipped([]);
		});

	const applyResponse = (
		resp: TranslateUnaryPayload<string[]>,
		len: number,
	) => {
		const normalized = normalizeUnaryResponse<string[]>(resp);
		const translated = Array.isArray(normalized.output)
			? normalized.output
			: [normalized.output];
		setResultTexts(translated, normalized.skipped);
		if (translated.length < len) {
			batch(() => {
				setError(
					{ from: translated.length, to: len - 1 },
					batchMismatchError(len, translated.length),
				);
				setTextResult({ from: translated.length, to: len - 1 }, undefined);
			});
		}
	};

	const translate = (texts: string[], cleanCache = false) => {
		const modelId_ = modelId();
		if (modelId_ === undefined) {
			setAllError(noModelError(), texts.length);
			return;
		}

		const srcLang_ = srcLang() || "auto";
		const dstLang_ = dstLang();
		const requestOptions = {
			modelId: modelId_,
			promptId,
			srcLang: srcLang_,
			dstLang: dstLang_,
			cleanCache,
			thinCache,
		};
		setAllLoading(texts.length);

		const abortController = new AbortController();
		pending.add(abortController);
		let endTracking: (() => void) | undefined;
		void (async () => {
			try {
				const skip = await detectAndSkip(
					detectionSample(texts),
					srcLang_,
					dstLang_,
					promptId,
				);
				if (abortController.signal.aborted) return;
				if (skip) {
					setAllSkipped(texts.length);
					return;
				}
				if (options.beforeTranslate && !cleanCache) {
					const cached = await window.rpc.cachedUnary(
						ctx(),
						requestOptions,
						texts,
						abortController.signal,
					);
					if (abortController.signal.aborted) return;
					if (cached) {
						applyResponse(cached, texts.length);
						return;
					}
				}
				endTracking = progressCtx?.beginRequest(modelId_);
				await options.beforeTranslate?.();
				if (abortController.signal.aborted) return;
				const resp = await window.rpc.unary(
					ctx(),
					requestOptions,
					texts,
					abortController.signal,
				);
				if (!abortController.signal.aborted) applyResponse(resp, texts.length);
			} catch (e) {
				if (!abortController.signal.aborted) {
					setAllError(convertGenericError(e), texts.length);
				}
			} finally {
				pending.delete(abortController);
				endTracking?.();
			}
		})();
	};

	const translateSingle = (index: number, text_: string) => {
		const modelId_ = modelId();
		if (modelId_ === undefined) {
			batch(() => {
				setError(index, noModelError());
				setTextResult(index, undefined);
			});
			return;
		}

		const srcLang_ = srcLang() || "auto";
		const dstLang_ = dstLang();
		batch(() => {
			setError(index, undefined);
			setTextResult(index, undefined);
			setSkipped(index, false);
		});

		const abortController = new AbortController();
		pending.add(abortController);
		let endTracking: (() => void) | undefined;
		void (async () => {
			try {
				const skip = await detectAndSkip(text_, srcLang_, dstLang_, promptId);
				if (abortController.signal.aborted) return;
				if (skip) {
					setSkipped(index, true);
					return;
				}
				endTracking = progressCtx?.beginRequest(modelId_);
				await options.beforeTranslate?.();
				if (abortController.signal.aborted) return;
				const resp = await window.rpc.unary(
					ctx(),
					{
						modelId: modelId_,
						promptId,
						srcLang: srcLang_,
						dstLang: dstLang_,
						cleanCache: true,
					},
					text_,
					abortController.signal,
				);
				if (abortController.signal.aborted) return;
				const normalized = normalizeUnaryResponse<string | string[]>(resp);
				const value = Array.isArray(normalized.output)
					? normalized.output[0]
					: normalized.output;
				batch(() => {
					setError(index, undefined);
					const responseSkipped = Array.isArray(normalized.skipped)
						? normalized.skipped[0] === true
						: normalized.skipped === true;
					setTextResult(index, responseSkipped ? undefined : value);
					setSkipped(index, responseSkipped);
				});
			} catch (e) {
				if (abortController.signal.aborted) return;
				batch(() => {
					setError(index, convertGenericError(e));
					setTextResult(index, undefined);
					setSkipped(index, false);
				});
			} finally {
				pending.delete(abortController);
				endTracking?.();
			}
		})();
	};

	createEffect(() => {
		const text_ = text();
		if (text_.length === 0) return;
		translate(text_);
		onCleanup(() => {
			cancelPending();
			clearAll();
		});
	});

	const retry = (index: number | undefined) => {
		const text_ = text();
		if (text_.length === 0) return;

		if (index === undefined) {
			translate(text_, true);
		} else if (index >= 0 && index < text_.length) {
			translateSingle(index, text_[index]);
		}
	};

	const ret = createMemo(() => {
		const len = text().length;
		return untrack(() =>
			Array.from({ length: len }, (_, i) => {
				function read(): string | undefined {
					return textResult[i];
				}

				Object.defineProperties(read, {
					error: {
						get() {
							return error[i];
						},
					},
					loading: {
						get() {
							// Access each store explicitly to track reactivity
							const hasResult = textResult[i] !== undefined;
							const hasError = error[i] !== undefined;
							const wasSkipped = skipped[i] === true;
							return !hasResult && !hasError && !wasSkipped;
						},
					},
					skipped: {
						get() {
							return skipped[i] === true;
						},
					},
				});

				return read as Result<string>;
			}),
		);
	});

	return [ret, retry];
}

type ResultWithReasoning<T> = Result<T> & { reasoning?: string };
type SingleReturn<T> = readonly [ResultWithReasoning<T>, retry: () => void];
type SingleStreamReturn<T> = readonly [
	ResultWithReasoning<T> & { len: number; streaming: boolean },
	retry: () => void,
];

export function createTranslation<T = string>(
	text: () => string,
	options: {
		stream: true;
		promptId: string;
		modelId: () => string | undefined;
		srcLang: () => string | undefined;
		dstLang: () => string;
		ctx?: () => TranslateContext;
	},
): SingleStreamReturn<T>;
export function createTranslation<T>(
	text: () => string,
	options: {
		stream?: false;
		modelId: () => string | undefined;
		srcLang: () => string | undefined;
		dstLang: () => string;
		promptId: string;
		ctx?: () => TranslateContext;
	},
): SingleReturn<T>;
export function createTranslation<T>(
	text: () => string,
	options: {
		stream?: boolean;
		promptId: string;
		modelId: () => string | undefined;
		srcLang: () => string | undefined;
		dstLang: () => string;
		ctx?: () => TranslateContext;
	},
): SingleReturn<T> | SingleStreamReturn<T> {
	const modelId = options.modelId;
	const srcLang = options.srcLang;
	const dstLang = options.dstLang;
	const promptId = options.promptId;
	const ctx = options.ctx || (() => ({}) as TranslateContext);
	const isStream = options.stream ?? false;
	const progressCtx = mightUseProgressIndicator();

	const [result, setResult] = createSignal<T>();
	const [error, setError] = createSignal<TranslateError>();
	const [reasoning, setReasoning] = createSignal<string>();
	const [isSkipped, setIsSkipped] = createSignal(false);

	const [len, setLen] = isStream ? createSignal(0) : [() => 0, () => {}];
	const [streaming, setStreaming] = isStream
		? createSignal(false)
		: [() => false, () => {}];

	const setLoading = () =>
		batch(() => {
			setError(undefined);
			setResult(undefined);
			setReasoning(undefined);
			setIsSkipped(false);
		});

	const setResultVal = (val: T, reasoning?: string) =>
		batch(() => {
			setError(undefined);
			setResult(() => val);
			setReasoning(reasoning);
			setIsSkipped(false);
		});

	const setSkippedVal = () =>
		batch(() => {
			setError(undefined);
			setResult(undefined);
			setReasoning(undefined);
			setIsSkipped(true);
			setLen(0);
			setStreaming(false);
		});

	const setErrorVal = (e: TranslateError) =>
		batch(() => {
			setError(e);
			setResult(undefined);
			setReasoning(undefined);
			setIsSkipped(false);
		});

	const translateStream = async (text_: string, cleanCache?: boolean) => {
		const modelId_ = modelId();
		if (modelId_ === undefined) {
			setErrorVal(noModelError());
			return;
		}

		if (await detectAndSkip(text_, srcLang(), dstLang(), promptId)) {
			setSkippedVal();
			return;
		}

		const endTracking = progressCtx?.beginRequest(modelId_);
		setLoading();

		const abortController = new AbortController();
		const listener = window.rpc.stream(
			ctx(),
			{
				modelId: modelId_,
				promptId,
				srcLang: srcLang() || "auto",
				dstLang: dstLang(),
				cleanCache,
			},
			text_,
			abortController.signal,
		);
		onCleanup(() => abortController.abort());

		try {
			setLen(0);
			setStreaming(true);
			for await (const chunk of listener as AsyncGenerator<TranslationStreamChunk>) {
				batch(() => {
					setError(undefined);
					if (!chunk) return;
					if (chunk.skipped) {
						setSkippedVal();
						return;
					}
					const content = chunk.content;
					const reasoning = chunk.reasoning;

					if (content) {
						// @ts-ignore stream request must return string chunks
						setResult((prev) => (prev || "") + content);
						setLen((prev: number) => prev + content.length);
					}
					if (reasoning) {
						setReasoning((prev) => (prev || "") + reasoning);
						setLen((prev: number) => prev + reasoning.length);
					}
				});
			}
		} catch (e) {
			if (abortController.signal.aborted) return;
			setErrorVal(convertGenericError(e));
		} finally {
			endTracking?.();
			setStreaming(false);
		}
	};

	const translateUnary = async (text_: string, cleanCache?: boolean) => {
		const modelId_ = modelId();
		if (modelId_ === undefined) {
			setErrorVal(noModelError());
			return;
		}

		if (await detectAndSkip(text_, srcLang(), dstLang(), promptId)) {
			setSkippedVal();
			return;
		}

		const endTracking = progressCtx?.beginRequest(modelId_);
		setLoading();

		const abortController = new AbortController();
		window.rpc
			.unary(
				ctx(),
				{
					modelId: modelId_,
					promptId,
					srcLang: srcLang() || "auto",
					dstLang: dstLang(),
					cleanCache,
				},
				text_,
				abortController.signal,
			)
			.then((resp) => {
				const normalized = normalizeUnaryResponse<T>(resp);
				const responseSkipped = Array.isArray(normalized.skipped)
					? normalized.skipped[0] === true
					: normalized.skipped === true;
				if (responseSkipped) {
					setSkippedVal();
					return;
				}
				const filter = createThinkingFilter();
				const filtered =
					typeof normalized.output === "string"
						? (((filter.process(normalized.output) || "") +
								(filter.flush() || "")) as T)
						: normalized.output;
				setResultVal(filtered, normalized.reasoning);
			})
			.catch((e) => {
				if (abortController.signal.aborted) return;
				setErrorVal(convertGenericError(e));
			})
			.finally(() => endTracking?.());

		onCleanup(() => abortController.abort());
	};

	const doTranslate = (text_: string, cleanCache?: boolean) =>
		isStream
			? translateStream(text_, cleanCache)
			: translateUnary(text_, cleanCache);

	createEffect(() => {
		const text_ = text();
		if (!text_) {
			return;
		}
		onCleanup(() =>
			batch(() => {
				setError(undefined);
				setResult(undefined);
				setReasoning(undefined);
				setIsSkipped(false);
			}),
		);
		doTranslate(text_);
	});

	const retry = () => {
		const text_ = text();
		if (text_.length === 0) return;
		doTranslate(text_, true);
	};

	function read(): T | undefined {
		return result();
	}

	Object.defineProperties(read, {
		error: {
			get: error,
		},
		reasoning: {
			get: reasoning,
		},
		loading: {
			get: () => {
				// Access each signal explicitly to track reactivity
				const hasResult = result() !== undefined;
				const hasError = error() !== undefined;
				return !hasResult && !hasError && !isSkipped();
			},
		},
		skipped: {
			get: isSkipped,
		},
		...(options.stream && {
			len: {
				get: len,
			},
			streaming: {
				get: streaming,
			},
		}),
	});

	return [read as ResultWithReasoning<T>, retry];
}
