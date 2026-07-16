import { Show } from "solid-js";
import { ContentStyle, KatexStyle, TranslationStyle } from "~/components/Style";
import { createFrameTranslationBridge } from "~/hooks/frame-translation";
import { ProgressIndicatorProvider } from "~/hooks/progress-indicator";
import { SettingsProvider } from "~/hooks/settings";
import { createTheme } from "~/hooks/theme";
import { WebsiteRuleProvider } from "~/hooks/website-rule";
import { getThemeClass } from "~/utils/theme";
import InTextTranslator from "./components/InTextTranslator";
import { PopupProvider, PopupRenderer } from "./components/Popup";
import ProgressIndicator from "./components/ProgressIndicator";
import SummaryHost from "./components/SummaryHost";
import TipRenderer from "./components/TipRenderer";
import TranslatorHost from "./components/TranslatorHost";

const Content = () => {
	// Media query is not supported in shadow DOM, so manually apply theme class
	const theme = createTheme();
	const isTopFrame = window.top === window;
	const [frameTranslationEnabled, publishFrameTranslationState] =
		createFrameTranslationBridge(isTopFrame);

	return (
		<div class="overlay-container" attr:data-theme={getThemeClass(theme())}>
			<ContentStyle />
			<TranslationStyle />
			<KatexStyle />
			<Show
				when={isTopFrame}
				fallback={
					<Show when={frameTranslationEnabled()} keyed>
						<InTextTranslator />
					</Show>
				}
			>
				<TranslatorHost
					onTranslationStateChange={publishFrameTranslationState}
				/>
				<SummaryHost />
				<PopupRenderer />
				<TipRenderer />
				<ProgressIndicator />
			</Show>
		</div>
	);
};

export default () => {
	return (
		<SettingsProvider>
			<ProgressIndicatorProvider>
				<PopupProvider>
					<WebsiteRuleProvider>
						<Content />
					</WebsiteRuleProvider>
				</PopupProvider>
			</ProgressIndicatorProvider>
		</SettingsProvider>
	);
};
