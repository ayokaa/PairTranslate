import { onCleanup, onMount } from "solid-js";
import { browser } from "#imports";
import { usePopup } from "~/entrypoints/content/components/Popup";
import { createKeyboardShortcut } from "~/hooks/keyboard-shortcut";
import { useSettings } from "~/hooks/settings";
import { makeDomainMatcher } from "~/utils/domain-matcher";
import { t } from "~/utils/i18n";
import { getPageContext } from "~/utils/page-context";
import { createLogger } from "~/utils/rpc/logger";
import { extractPageContent } from "~/utils/summary/extract";
import SummaryPanel from "./SummaryPanel";

const logger = createLogger(import.meta.env.DEV ? "debug" : "error", "Summary");

const SUMMARY_MESSAGE_TYPE = "generate-summary";
const SUMMARY_POPUP_WIDTH = 420;
const SUMMARY_POPUP_MARGIN = 12;

const clampPosition = (width: number, height: number) => ({
	x: Math.max(
		SUMMARY_POPUP_MARGIN,
		window.innerWidth - width - SUMMARY_POPUP_MARGIN,
	),
	y: Math.max(
		SUMMARY_POPUP_MARGIN,
		Math.min(80, window.innerHeight - height - SUMMARY_POPUP_MARGIN),
	),
});

export default () => {
	const popup = usePopup();
	const { settings } = useSettings();
	let popupActions: ReturnType<typeof popup.addPopup> | undefined;
	let messageListener: ((message: unknown) => void) | undefined;

	const closeExistingPopup = () => {
		if (popupActions) {
			popupActions.close();
			popupActions = undefined;
		}
	};

	const handleGenerateSummary = () => {
		const excludedSites = settings.translate.summaryExcludedSites;
		if (excludedSites.length > 0) {
			const matcher = makeDomainMatcher(excludedSites);
			if (matcher(window.location.hostname) !== null) {
				logger.info("Site is excluded from summary");
				closeExistingPopup();
				return;
			}
		}

		logger.info("Generating summary...");
		closeExistingPopup();

		const { content, truncated } = extractPageContent();
		logger.info(`Extracted ${content.length} chars (truncated=${truncated})`);
		if (!content.trim()) {
			logger.warn("No content extracted");
			popupActions = popup.addPopup({
				...clampPosition(SUMMARY_POPUP_WIDTH, 160),
				width: SUMMARY_POPUP_WIDTH,
				height: 160,
				content: () => (
					<div class="p-4 text-sm text-base-content/70">
						{t("summary.noContent")}
					</div>
				),
			});
			return;
		}

		const pageContext = getPageContext();
		logger.info("Creating summary popup");

		popupActions = popup.addPopup({
			...clampPosition(SUMMARY_POPUP_WIDTH, 520),
			width: SUMMARY_POPUP_WIDTH,
			height: 520,
			content: () => (
				<SummaryPanel
					content={content}
					truncated={truncated}
					pageContext={pageContext}
				/>
			),
		});
	};

	onMount(() => {
		const listener = (message: unknown) => {
			logger.debug("Received message:", message);
			if (
				message &&
				typeof message === "object" &&
				"type" in message &&
				(message as { type: string }).type === SUMMARY_MESSAGE_TYPE
			) {
				logger.debug("Message matched, handling...");
				handleGenerateSummary();
			} else {
				logger.debug("Message ignored, type mismatch:", message);
			}
		};

		messageListener = listener;
		browser.runtime.onMessage.addListener(listener);
	});

	onCleanup(() => {
		if (messageListener) {
			browser.runtime.onMessage.removeListener(messageListener);
		}
	});

	createKeyboardShortcut(
		() => settings.basic.keyboardShortcutForSummary,
		() => {
			const modelId = settings.translate.summaryModel;
			if (!modelId) {
				logger.debug("Shortcut ignored: no summary model configured");
				return;
			}
			logger.info("Shortcut triggered");
			handleGenerateSummary();
		},
		{
			enabled: () =>
				settings.basic.keyboardShortcutEnabled &&
				settings.basic.keyboardShortcutSummarizes,
			allowInInput: false,
		},
	);

	return null;
};
