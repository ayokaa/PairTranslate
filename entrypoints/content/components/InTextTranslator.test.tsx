import { expect, mock, test } from "bun:test";
import { createStore, reconcile } from "solid-js/store";
import type { DOMSection } from "~/utils/parser/types";
import type { ModelSelectionSettings } from "~/utils/settings/model-selection";
import type { TranslationResponse } from "~/utils/translation-result";

const [settings] = createStore({
	translate: {
		inTextTranslateModel: {
			modelId: "fallback-model",
		} as ModelSelectionSettings,
		sourceLang: "en",
		targetLang: "zh-CN",
		filterInteractive: true,
		translateFullPage: true,
	},
	services: {},
	queue: {},
	webAdaptation: { rules: [] },
	debug: { disableCache: false },
});
const [websiteRule, setWebsiteRule] = createStore<{
	inTextTranslateModel?: ModelSelectionSettings;
	sourceLang?: string;
	targetLang?: string;
	filterInteractive?: boolean;
	translateFullPage?: boolean;
}>({
	inTextTranslateModel: { modelId: "model-1", thinkingBudget: "high" },
});

let currentSection: DOMSection;
let displayed: string[] = [];

mock.module("~/hooks/settings", () => ({
	useSettings: () => ({ settings }),
}));
mock.module("~/hooks/website-rule", () => ({
	useWebsiteRule: () => websiteRule,
}));
mock.module("@/hooks/observer", () => ({
	createNodeObserver: () => [() => {}, () => {}],
}));
mock.module("~/utils/page-context", () => ({
	getPageContext: () => ({ url: "https://example.com/article" }),
}));
mock.module("~/utils/settings/services", () => ({
	resolveQueueSettings: () => ({
		requestConcurrency: 1,
		tokensPerMinute: 1000,
		maxBatchSize: 1,
		maxTokensPerBatch: 1000,
	}),
}));
mock.module("../parser", () => ({
	getDomListener: async () =>
		(async function* () {
			yield currentSection;
		})(),
}));
mock.module("../web-adaptation/observations", () => ({
	clearTranslationObservations: () => {},
}));
mock.module("../native-components/InTextTranslate", () => ({
	BatchInTextTranslation: () => null,
	BatchRender: (props: {
		takeCached?: () => TranslationResponse<string[]> | undefined;
	}) => {
		const cached = props.takeCached?.();
		if (cached) displayed.push(...cached.output);
		return null;
	},
	useInTextPageContext: () => ({}),
}));

const { render } = await import("solid-js/web");
const { default: InTextTranslator } = await import("./InTextTranslator");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("changing in-text effort aborts a pending probe and rebuilds the queue", async () => {
	const firstStarted = Promise.withResolvers<AbortSignal>();
	const secondStarted = Promise.withResolvers<AbortSignal>();
	const firstReply = Promise.withResolvers<TranslationResponse<string[]>>();
	const secondReply = Promise.withResolvers<TranslationResponse<string[]>>();
	const cachedUnary = mock(
		(
			_ctx: unknown,
			options: { thinkingBudget?: string },
			_texts: string[],
			signal: AbortSignal,
		) => {
			if (options.thinkingBudget === "high") {
				firstStarted.resolve(signal);
				return firstReply.promise;
			}
			secondStarted.resolve(signal);
			return secondReply.promise;
		},
	);
	const originalWindow = globalThis.window;
	Object.assign(globalThis, {
		window: {
			document,
			location: { hostname: "example.com" },
			rpc: { cachedUnary },
		},
	});
	displayed = [];
	const paragraph = document.createElement("p");
	const source = document.createTextNode("Paragraph");
	paragraph.append(source);
	document.body.append(paragraph);
	currentSection = [source, source];
	const host = document.createElement("div");
	document.body.append(host);
	const dispose = render(() => <InTextTranslator />, host);

	try {
		const firstSignal = await firstStarted.promise;
		const selection = websiteRule.inTextTranslateModel;
		setWebsiteRule(
			reconcile({
				inTextTranslateModel: { modelId: "model-1", thinkingBudget: "off" },
			}),
		);
		expect(websiteRule.inTextTranslateModel).toBe(selection);
		await flush();

		expect(firstSignal.aborted).toBe(true);
		expect(cachedUnary).toHaveBeenCalledTimes(2);
		expect(cachedUnary.mock.calls[1][1]).toMatchObject({
			thinkingBudget: "off",
		});
		const secondSignal = await secondStarted.promise;
		expect(secondSignal.aborted).toBe(false);

		firstReply.resolve({ output: ["stale high"], skipped: false });
		await flush();
		expect(displayed).toEqual([]);

		secondReply.resolve({ output: ["fresh off"], skipped: false });
		await flush();
		expect(displayed).toEqual(["fresh off"]);
	} finally {
		firstReply.resolve({ output: ["stale high"], skipped: false });
		secondReply.resolve({ output: ["fresh off"], skipped: false });
		dispose();
		host.remove();
		paragraph.remove();
		Object.assign(globalThis, { window: originalWindow });
		await flush();
	}
});
