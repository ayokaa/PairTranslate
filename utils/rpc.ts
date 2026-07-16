/** biome-ignore-all lint/suspicious/noExplicitAny: any type can be returned */

import type { DictionaryResponse } from "./dictionary";
import type { RpcService } from "./rpc/factory";
import type {
	TranslationResponse,
	TranslationStreamChunk,
} from "./translation-result";
import type { TranslateContext, TranslateQueueStatus } from "./types";

export interface CoreService extends RpcService {
	ping(): Promise<string>;
}

export interface TranslateService extends RpcService {
	unary(
		ctx: TranslateContext,
		options: TranslateOptions,
		text?: string | string[],
	): Promise<TranslationResponse<any>>;
	stream(
		ctx: TranslateContext,
		options: TranslateOptions,
		text?: string | string[],
	): AsyncGenerator<TranslationStreamChunk, void, unknown>;
	queueStatus(modelId: string): AsyncGenerator<TranslateQueueStatus>;
	clearCache(): Promise<void>;
}

export interface TranslateOptions {
	modelId: string;
	promptId: string;
	cleanCache?: boolean;
	thinCache?: boolean;
	srcLang: string;
	dstLang: string;
}

export interface StyleService extends RpcService {
	getContentStyles(): Promise<[documentCss: string, shadowCss: string]>;
}

export interface MatchService extends RpcService {
	matchParser(domain: string): Promise<number | null>;
	matchWebsiteRule(domain: string): Promise<number | null>;
}

export interface DictionaryService extends RpcService {
	lookup(word: string): Promise<DictionaryResponse | null>;
}

export interface AllServices
	extends CoreService,
		TranslateService,
		StyleService,
		MatchService,
		DictionaryService {}

export interface AudioService extends RpcService {
	play(url: string): Promise<void>;
	stop(): Promise<void>;
}

export interface IframeServices extends AudioService {}

export * from "./rpc/core";
export * from "./rpc/factory";
export * from "./rpc/iframe";
export * from "./rpc/iframe-def";
export * from "./rpc/logger";
export * from "./rpc/wxt";
export * from "./rpc/wxt-def";
