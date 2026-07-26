import { CircleX, Languages } from "lucide-solid";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	Index,
	type JSX,
	on,
	onCleanup,
	Show,
} from "solid-js";
import { createIdleDebounce } from "@/hooks/throttle";
import { Md } from "~/components/MD/Md";
import { TranslateNodePortal } from "~/components/MPortal";
import { useSettings } from "~/hooks/settings";
import { createBatchTranslation } from "~/hooks/translation";
import { useWebsiteRule } from "~/hooks/website-rule";
import { DATA_TRANSLATION_TEXT, PROMPT_ID } from "~/utils/constants";
import { copyToClipboard } from "~/utils/copy";
import { t } from "~/utils/i18n";
import { getMarkdownFromSection } from "~/utils/markdown";
import { getPageContext } from "~/utils/page-context";
import type { DOMSection } from "~/utils/parser/types";
import { estimateTokens } from "~/utils/token-estimate";
import InTextTooltip from "../components/InTextTooltip";
import { NativeLoading } from "./Loading";

const NEW_LINE_THRESHOLD = 10;

let closeActiveTooltip: (() => void) | undefined;

/**
 * Where to anchor the action menu for a trigger event.
 *
 * Uses duck typing rather than `instanceof`: `TouchEvent` is undefined on
 * desktop Firefox, so an `instanceof TouchEvent` test throws a ReferenceError
 * for every non-mouse event and leaves the menu unopenable. Keyboard-driven
 * clicks report (0, 0), so those fall back to the trigger's own box.
 */
const pointerPosition = (e: MouseEvent | TouchEvent | FocusEvent) => {
	const touch = "changedTouches" in e ? e.changedTouches[0] : undefined;
	if (touch) return { x: touch.clientX, y: touch.clientY };

	if ("clientX" in e && (e.clientX !== 0 || e.clientY !== 0)) {
		return { x: e.clientX, y: e.clientY };
	}

	const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
	return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

type SectionTextPair = [DOMSection, string];

interface BatchProps {
	sections: Set<DOMSection>;
	onDelete?: (section: DOMSection) => void;
}
export const BatchInTextTranslation = (props: BatchProps) => {
	const { settings } = useSettings();
	const websiteRule = useWebsiteRule();
	const [renderList, setRenderList] = createSignal([] as SectionTextPair[][], {
		equals: false,
	});

	const batchIds = new Map<DOMSection, number>();

	const clear = () => {
		setRenderList([]);
		batchIds.clear();
	};

	createEffect(
		on(
			[() => props.sections],
			([currentSections]) => {
				if (currentSections.size === 0) {
					clear();
					return;
				}

				createIdleDebounce(() => {
					const currentModelQueueSettings =
						settings.services[
							websiteRule.inTextTranslateModel ||
								settings.translate.inTextTranslateModel ||
								""
						]?.queue;
					const maxBatchSize =
						currentModelQueueSettings?.maxBatchSize ||
						settings.queue.maxBatchSize;

					setRenderList((prev) => {
						const maxTokensPerBatch =
							currentModelQueueSettings?.maxTokensPerBatch ||
							settings.queue.maxTokensPerBatch;

						let last = prev.length; // Force a new batch
						for (const section of currentSections) {
							const batchId = batchIds.get(section);
							const current: SectionTextPair = [
								section,
								getMarkdownFromSection(section),
							];
							if (batchId === undefined) {
								const lastBatch = prev[last];
								if (lastBatch !== undefined) {
									const estimatedTokens = estimateTokens([
										...lastBatch.map(([, text]) => text),
										current[1],
									]);
									if (
										lastBatch.length < maxBatchSize &&
										estimatedTokens <= maxTokensPerBatch
									) {
										prev[last] = [...lastBatch, current];
									} else {
										prev.push([current]);
										last++;
									}
								} else {
									prev.push([current]);
								}
								batchIds.set(section, last);
							} else {
								// Element already has a batch, do nothing.
							}
						}

						for (const [section, batchId] of batchIds.entries()) {
							if (!currentSections.has(section)) {
								const batch = prev[batchId];
								if (!batch) {
									batchIds.delete(section);
									continue;
								}
								const index = batch.findIndex(([el]) => el === section);
								if (index !== -1) {
									prev[batchId] = [
										...batch.slice(0, index),
										...batch.slice(index + 1),
									];
								}
								batchIds.delete(section);
							}
						}

						return prev;
					});
				});
			},
			{ defer: true },
		),
	);

	return (
		<Index each={renderList()}>
			{(sections) => (
				<BatchRender sections={sections()} onDelete={props.onDelete} />
			)}
		</Index>
	);
};

interface BatchRenderProps {
	sections: SectionTextPair[];
	onDelete?: (section: DOMSection) => void;
}
const BatchRender = (props: BatchRenderProps) => {
	const { settings } = useSettings();
	const websiteRule = useWebsiteRule();
	const texts = createMemo(() => props.sections.map(([, text]) => text));
	const [getter, retry] = createBatchTranslation(texts, {
		promptId: PROMPT_ID.batchTranslate,
		modelId: () => settings.translate.inTextTranslateModel,
		srcLang: () => websiteRule.sourceLang || settings.translate.sourceLang,
		dstLang: () => websiteRule.targetLang || settings.translate.targetLang,
		ctx: () => ({
			page: getPageContext(),
		}),
	});

	const hideOriginal = createMemo(
		() =>
			(websiteRule.translateMode ?? settings.translate.translationMode) ===
			"replace",
	);
	const showLanguageIcon = createMemo(
		() => settings.translate.inTextTranslateIconEnabled ?? true,
	);
	const showTranslationActions = createMemo(
		() => settings.translate.inTextTranslationActionsEnabled,
	);

	return (
		<For each={getter()}>
			{(item, index) => (
				<TranslationRender
					text={item()}
					loading={item.loading}
					skipped={item.skipped}
					error={item.error?.message}
					section={props.sections[index()][0]}
					hideOriginal={hideOriginal()}
					showLanguageIcon={showLanguageIcon()}
					showTranslationActions={showTranslationActions()}
					onRetry={() => {
						if (getter().every((i) => i.error)) {
							retry();
						} else {
							retry(index());
						}
					}}
					onDelete={() => props.onDelete?.(props.sections[index()][0])}
				/>
			)}
		</For>
	);
};

interface TranslationRenderProps {
	text?: string;
	loading?: boolean;
	skipped: boolean;
	error?: string;
	hideOriginal: boolean;
	section: DOMSection;
	showLanguageIcon: boolean;
	showTranslationActions: boolean;
	onRetry?: () => void;
	onDelete?: () => void;
}
export const TranslationRender = (props: TranslationRenderProps) => {
	const [tooltipPos, setTooltipPos] = createSignal<{ x: number; y: number }>();
	const shouldRender = () =>
		!props.skipped &&
		(props.loading ||
			!!props.error ||
			(props.text !== undefined && props.text !== ""));
	const hasLeadingContent = createMemo(
		() => props.loading || !!props.error || props.showLanguageIcon,
	);
	// The action menu is normally opt-in, but an errored translation always keeps
	// its menu so the cause stays visible and retry/delete stay reachable.
	const canOpenMenu = createMemo(
		() =>
			(props.showTranslationActions || !!props.error) && hasLeadingContent(),
	);
	const closeTooltip = () => {
		setTooltipPos(undefined);
		if (closeActiveTooltip === closeTooltip) closeActiveTooltip = undefined;
	};
	const createTooltip = (e: MouseEvent | TouchEvent | FocusEvent) => {
		e.preventDefault();
		e.stopPropagation();

		// Loading never pops a menu (avoid covering the loading state).
		if (props.loading || !canOpenMenu()) return;
		if (tooltipPos()) return;
		const { x, y } = pointerPosition(e);
		closeActiveTooltip?.();
		setTooltipPos({
			x,
			y,
		});
		closeActiveTooltip = closeTooltip;
	};
	createEffect(() => {
		// Keep the open menu in sync with the condition that renders it, so a
		// dangling position can never block the trigger from opening it again.
		if (!canOpenMenu()) closeTooltip();
	});
	onCleanup(closeTooltip);

	const swapLine = createMemo(
		() =>
			!props.loading &&
			!props.error &&
			!props.hideOriginal &&
			((props.text || "").length > NEW_LINE_THRESHOLD ||
				props.text?.includes("\n")),
	);
	const leadingContent = createMemo(() => {
		if (props.loading) return <NativeLoading />;
		if (props.error) return <CircleX style={ERROR_ICON_STYLE} size="12px" />;
		if (props.showLanguageIcon) {
			return <Languages style={ICON_STYLE} size="12px" />;
		}
		return null;
	});

	return (
		<Show when={shouldRender()}>
			<Show when={canOpenMenu()}>
				<InTextTooltip
					pos={tooltipPos()}
					error={props.error}
					onClose={closeTooltip}
					onCopyMarkdown={() => {
						if (props.text) {
							copyToClipboard(props.text);
						}
						closeTooltip();
					}}
					onRetry={() => {
						props.onRetry?.();
						closeTooltip();
					}}
					onDelete={() => {
						props.onDelete?.();
						closeTooltip();
					}}
				/>
			</Show>
			<TranslateNodePortal
				section={props.section}
				hideOriginal={props.hideOriginal && !props.loading && !props.error}
			>
				{swapLine() && <br />}
				<Show when={hasLeadingContent()}>
					<Show
						when={canOpenMenu()}
						fallback={
							<span style={{ display: "inline-block" }}>
								{leadingContent()}
							</span>
						}
					>
						<button
							type="button"
							aria-label={t("actions.translationActions")}
							disabled={props.loading}
							on:mouseenter={createTooltip}
							on:click={createTooltip}
							on:touchend={createTooltip}
							on:focus={createTooltip}
							on:keydown={(event) => {
								if (event.key === "Escape") closeTooltip();
							}}
							style={ACTION_TRIGGER_STYLE}
						>
							{leadingContent()}
						</button>
					</Show>
				</Show>
				{!props.loading && !props.error && (
					<span {...{ [DATA_TRANSLATION_TEXT]: "" }}>
						<Md text={props.text || ""} />
					</span>
				)}
			</TranslateNodePortal>
		</Show>
	);
};

const ICON_STYLE = {
	"vertical-align": "middle",
	margin: "0 4px",
	background: "rgba(0, 0, 0, 0.1)",
	"border-radius": "4px",
	padding: "2px",
};

const ERROR_ICON_STYLE = {
	...ICON_STYLE,
	background: "rgba(255, 0, 0, 0.1)",
};

const ACTION_TRIGGER_STYLE: JSX.CSSProperties = {
	display: "inline-block",
	appearance: "none" as const,
	padding: "0",
	margin: "0",
	border: "0",
	background: "transparent",
	color: "inherit",
	font: "inherit",
	"line-height": "inherit",
	"min-width": "0",
	"min-height": "0",
	"box-shadow": "none",
	cursor: "pointer",
};
