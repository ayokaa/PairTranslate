import { createSignal, onCleanup } from "solid-js";
import { type Browser, browser } from "#imports";
import {
	createFrameTranslationStateMessage,
	FRAME_TRANSLATION_PORT_NAME,
	isFrameTranslationStateMessage,
} from "~/utils/frame-translation";

export const createFrameTranslationBridge = (isTopFrame: boolean) => {
	const [enabled, setEnabled] = createSignal(false);
	let port: Browser.runtime.Port | undefined;
	let lastPublishedState = false;

	const sendState = (next: boolean) => {
		try {
			port?.postMessage(createFrameTranslationStateMessage(next));
		} catch {
			// The page or extension is being unloaded.
		}
	};

	const connect = () => {
		const currentPort = browser.runtime.connect({
			name: FRAME_TRANSLATION_PORT_NAME,
		});
		port = currentPort;

		const handleMessage = (message: unknown) => {
			if (!isTopFrame && isFrameTranslationStateMessage(message)) {
				setEnabled(message.enabled);
			}
		};
		const handleDisconnect = () => {
			// Reading lastError prevents expected disconnects from being reported.
			void browser.runtime.lastError;
			currentPort.onMessage.removeListener(handleMessage);
			currentPort.onDisconnect.removeListener(handleDisconnect);
			if (port === currentPort) port = undefined;
			if (!isTopFrame) setEnabled(false);
		};

		currentPort.onMessage.addListener(handleMessage);
		currentPort.onDisconnect.addListener(handleDisconnect);
		if (isTopFrame) sendState(lastPublishedState);
	};

	const disconnect = () => {
		const currentPort = port;
		port = undefined;
		try {
			currentPort?.disconnect();
		} catch {
			// The port may already be disconnected during navigation.
		}
	};

	const handlePageShow = (event: PageTransitionEvent) => {
		if (!event.persisted) return;
		disconnect();
		connect();
	};

	connect();
	window.addEventListener("pageshow", handlePageShow);
	onCleanup(() => {
		window.removeEventListener("pageshow", handlePageShow);
		disconnect();
	});

	return [
		enabled,
		(next: boolean) => {
			if (!isTopFrame) return;
			lastPublishedState = next;
			sendState(next);
		},
	] as const;
};
