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

	// Whether the user has an explicit per-URL choice (from page-state or from
	// toggling in this session). When explicit, it wins over website rules.
	const [hasExplicitChoice, setHasExplicitChoice] = createSignal(false);
	const [restored, setRestored] = createSignal(false);

	const [remaining] = createDomainEnabledTimer();
	createEffect(() => {
		if ((remaining() || 0) > 0) setInTextTranslateEnabled(true);
	});

	// Website rules act as defaults: they only apply when the user has not made
	// an explicit choice for this URL.
	createEffect(() => {
		if (!restored()) return;
		if (hasExplicitChoice()) return;
		const rule = websiteRule.enableTranslation;
		if (rule !== undefined) {
			setInTextTranslateEnabled((prev) => rule ?? prev);
		}
	});

	// Toggle the in-text translation switch and persist the choice per-URL so it
	// can be restored after a reload/browser restart (when restorePageState is on).
	const toggleTranslate = (next?: boolean) => {
		const resolved = next ?? !inTextTranslateEnabled();
		setInTextTranslateEnabled(resolved);
		// Any manual toggle counts as an explicit user choice for this session.
		setHasExplicitChoice(true);
		if (settings.basic.restorePageState) {
			savePageState(window.location.href, {
				translateEnabled: resolved,
			}).catch(() => {});
		}
	};

	// Restore per-page state once on mount. A saved translateEnabled value (or a
	// manual toggle in this session) takes precedence over website rules.
	onMount(() => {
		if (!settings.basic.restorePageState) {
			setRestored(true);
			return;
		}
		loadPageState(window.location.href)
			.then((state) => {
				if (state) {
					setInTextTranslateEnabled(state.translateEnabled);
					setHasExplicitChoice(true);
				}
			})
			.catch(() => {})
			.finally(() => setRestored(true));
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
