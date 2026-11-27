import { trackDeep } from "@solid-primitives/deep";
import { createEffect, createSignal, For, onCleanup } from "solid-js";
import { createNodeObserver } from "@/hooks/observer";
import { useSettings } from "~/hooks/settings";
import { useWebsiteRule } from "~/hooks/website-rule";
import { PROMPT_ID } from "~/utils/constants";
import { areLanguagesSame } from "~/utils/language";
import { nextTask } from "~/utils/next-task";
import { getPageContext } from "~/utils/page-context";
import { isDisplayOnlySection } from "~/utils/parser/math-section";
import type { DOMSection } from "~/utils/parser/types";
import { resolveQueueSettings } from "~/utils/settings/services";
import {
	createFullPageBatches,
	type FullPageBatch,
} from "../full-page-batches";
import {
	BatchInTextTranslation,
	BatchRender,
	useInTextPageContext,
} from "../native-components/InTextTranslate";
import { getDomListener } from "../parser";
import { clearTranslationObservations } from "../web-adaptation/observations";

export default () => {
	const { settings } = useSettings();
	const websiteRule = useWebsiteRule();

	const [sections, setSections] = createSignal(new Set<DOMSection>(), {
		equals: false,
	});

	const [batches, setBatches] = createSignal<FullPageBatch[]>([]);
	const pageContext = useInTextPageContext(() => batches().length > 0);

	function fullPageQueue() {
		const selection =
			websiteRule.inTextTranslateModel ??
			settings.translate.inTextTranslateModel;
		const modelId = selection?.modelId;
		const thinkingBudget = selection?.thinkingBudget;
		const limits = resolveQueueSettings(
			settings.services,
			settings.queue,
			modelId,
		);
		const srcLang =
			websiteRule.sourceLang || settings.translate.sourceLang || "auto";
		const dstLang = websiteRule.targetLang || settings.translate.targetLang;
		const probe =
			modelId &&
			!settings.debug?.disableCache &&
			(srcLang === "auto" || !areLanguagesSame(srcLang, dstLang))
				? (texts: string[], signal: AbortSignal) =>
						window.rpc.cachedUnary(
							{ page: getPageContext() },
							{
								modelId,
								thinkingBudget,
								srcLang,
								dstLang,
								promptId: PROMPT_ID.batchTranslate,
								thinCache: true,
							},
							texts,
							signal,
						)
				: undefined;
		return createFullPageBatches(
			limits,
			(batch) => setBatches((prev) => [...prev, batch]),
			(batch) => setBatches((prev) => prev.filter((item) => item !== batch)),
			probe,
		);
	}

	createEffect(() => {
		const [listenIntersectionOrRemove, listenRemove] = createNodeObserver();

		const filterInteractive =
			websiteRule.filterInteractive ?? settings.translate.filterInteractive;
		const fullPage =
			websiteRule.translateFullPage ?? settings.translate.translateFullPage;
		const hostname = window.location.hostname;
		const adaptationRules = trackDeep(settings.webAdaptation.rules);

		const queue = fullPage ? fullPageQueue() : undefined;

		const buffer = {
			add: new Set<DOMSection>(),
			del: new Set<DOMSection>(),
			handle: null as number | null,
		};

		const flush = () => {
			setSections((prev) => {
				if (buffer.add.size === 0 && buffer.del.size === 0) return prev;

				for (const section of buffer.add) prev.add(section);
				for (const section of buffer.del) prev.delete(section);

				buffer.add.clear();
				buffer.del.clear();
				buffer.handle = null;

				return prev;
			});
		};

		const scheduleFlush = () => {
			if (buffer.handle !== null) return;
			buffer.handle = requestAnimationFrame(flush);
		};

		const handleAdd = (section: DOMSection) => {
			if (isDisplayOnlySection(section)) return;

			buffer.del.delete(section);
			buffer.add.add(section);
			scheduleFlush();
		};

		const handleRemove = (section: DOMSection) => {
			buffer.add.delete(section);
			buffer.del.add(section);
			scheduleFlush();
		};

		const controller = new AbortController();
		(async () => {
			const listener = await getDomListener(
				hostname,
				{
					filterInteractive,
					signal: controller.signal,
				},
				adaptationRules,
			);
			if (controller.signal.aborted) return;

			let scanned = 0;
			for await (const section of listener) {
				if (controller.signal.aborted) break;
				if (queue) {
					queue.add(section);
					const remove = () => queue.remove(section);
					listenRemove(section[0], remove);
					if (section[1] !== section[0]) listenRemove(section[1], remove);
					if (++scanned >= queue.scanWindow) {
						scanned = 0;
						await new Promise<void>((resolve) => nextTask(resolve));
						if (controller.signal.aborted) break;
					}
				} else {
					listenIntersectionOrRemove(section[0], (shouldRender) => {
						shouldRender ? handleAdd(section) : handleRemove(section);
					});
				}
			}
		})();

		onCleanup(() => {
			controller.abort();
			setBatches([]);
			clearTranslationObservations();
			if (buffer.handle !== null) cancelAnimationFrame(buffer.handle);
			setSections((prev) => {
				prev.clear();
				return prev;
			});
		});
	});

	const onDelete = (section: DOMSection) => {
		setSections((prev) => {
			prev.delete(section);
			return prev;
		});
	};

	return (
		<>
			<BatchInTextTranslation sections={sections()} onDelete={onDelete} />
			<For each={batches()}>
				{(batch) => (
					<BatchRender
						sections={batch.sections()}
						pageContext={pageContext}
						onSettled={batch.settled}
						takeCached={batch.takeCached}
						onDelete={batch.remove}
					/>
				)}
			</For>
		</>
	);
};
