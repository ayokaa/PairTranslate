import { createEffect, createSignal, onMount, Show } from "solid-js";
import { createDomainEnabledTimer } from "~/hooks/domain-timer";
import { createKeyboardShortcut } from "~/hooks/keyboard-shortcut";
import { useSettings } from "~/hooks/settings";
import { useWebsiteRule } from "~/hooks/website-rule";
import { loadPageState, savePageState } from "~/utils/page-state";
import FloatingBall from "./FloatingBall";
import FourFingerTap from "./FourFingerTap";
import InputTranslator from "./InputTranslator";
import InTextTranslator from "./InTextTranslator";
import SelectionInTextTranslator from "./SelectionInTextTranslator";

export default () => {
	const { settings } = useSettings();
	const websiteRule = useWebsiteRule();
	const [inTextTranslateEnabled, setInTextTranslateEnabled] =
		createSignal(false);
	const [inputTranslateElement, setInputTranslateElement] = createSignal<
		HTMLElement | undefined
	>(undefined, { equals: false });

	const [remaining] = createDomainEnabledTimer();
	createEffect(() => {
		if ((remaining() || 0) > 0) setInTextTranslateEnabled(true);
	});

	createEffect(() => {
		setInTextTranslateEnabled((prev) => websiteRule.enableTranslation ?? prev);
	});

	// Toggle the in-text translation switch and persist the choice per-URL so it
	// can be restored after a reload/browser restart (when restorePageState is on).
	const toggleTranslate = (next?: boolean) => {
		const resolved = next ?? !inTextTranslateEnabled();
		setInTextTranslateEnabled(resolved);
		if (settings.basic.restorePageState) {
			savePageState(window.location.href, {
				translateEnabled: resolved,
			}).catch(() => {});
		}
	};

	// Restore per-page state once on mount, unless a website rule explicitly
	// overrides the translation flag (in which case the rule wins).
	onMount(() => {
		if (!settings.basic.restorePageState) return;
		if (websiteRule.enableTranslation !== undefined) return;
		loadPageState(window.location.href)
			.then((state) => {
				if (state?.translateEnabled) setInTextTranslateEnabled(true);
			})
			.catch(() => {});
	});

	// Handle keyboard shortcut
	createKeyboardShortcut(
		() => settings.basic.keyboardShortcut,
		(event, inInput) => {
			if (inInput && settings.basic.inputTranslateEnabled) {
				setInputTranslateElement(event.target as HTMLElement);
			} else {
				toggleTranslate();
			}
		},
		{
			enabled: () => settings.basic.keyboardShortcutEnabled,
			allowInInput: true,
		},
	);

	return (
		<>
			<Show
				when={
					websiteRule.floatingBallEnabled ?? settings.basic.floatingBallEnabled
				}
				keyed
			>
				<FloatingBall
					translateEnabled={inTextTranslateEnabled()}
					onSwitch={() => toggleTranslate()}
				/>
			</Show>

			<FourFingerTap onToggle={() => toggleTranslate()} />

			<Show when={inTextTranslateEnabled()} keyed>
				<InTextTranslator />
			</Show>

			<Show when={settings.basic.inputTranslateEnabled} keyed>
				<InputTranslator
					element={inputTranslateElement()}
					onClose={() => setInputTranslateElement(undefined)}
				/>
			</Show>

			<Show when={settings.basic.selectionTranslateEnabled} keyed>
				<SelectionInTextTranslator />
			</Show>
		</>
	);
};
