import type { Browser } from "#imports";
import {
	createFrameTranslationStateMessage,
	FRAME_TRANSLATION_PORT_NAME,
	isFrameTranslationStateMessage,
} from "~/utils/frame-translation";

type TabFrameState = {
	enabled: boolean;
	topPort?: Browser.runtime.Port;
	ports: Map<Browser.runtime.Port, number>;
};

export class FrameTranslationRelay {
	private readonly tabs = new Map<number, TabFrameState>();

	connect = (port: Browser.runtime.Port) => {
		if (port.name !== FRAME_TRANSLATION_PORT_NAME) return;

		const tabId = port.sender?.tab?.id;
		const frameId = port.sender?.frameId;
		if (typeof tabId !== "number" || typeof frameId !== "number") {
			port.disconnect();
			return;
		}

		let state = this.tabs.get(tabId);
		if (!state) {
			state = { enabled: false, ports: new Map() };
			this.tabs.set(tabId, state);
		}
		state.ports.set(port, frameId);

		if (frameId === 0) {
			state.topPort = port;
			state.enabled = false;
			this.broadcastToChildFrames(state);
		} else {
			this.sendState(port, state.enabled);
		}

		const handleMessage = (message: unknown) => {
			if (state?.topPort !== port || !isFrameTranslationStateMessage(message)) {
				return;
			}

			state.enabled = message.enabled;
			this.broadcastToChildFrames(state);
		};
		const handleDisconnect = () => {
			port.onMessage.removeListener(handleMessage);
			port.onDisconnect.removeListener(handleDisconnect);
			state?.ports.delete(port);

			if (state?.topPort === port) {
				state.topPort = undefined;
				state.enabled = false;
				this.broadcastToChildFrames(state);
			}
			if (state?.ports.size === 0) this.tabs.delete(tabId);
		};

		port.onMessage.addListener(handleMessage);
		port.onDisconnect.addListener(handleDisconnect);
	};

	private broadcastToChildFrames(state: TabFrameState) {
		for (const [port, frameId] of state.ports) {
			if (frameId !== 0) this.sendState(port, state.enabled);
		}
	}

	private sendState(port: Browser.runtime.Port, enabled: boolean) {
		try {
			port.postMessage(createFrameTranslationStateMessage(enabled));
		} catch {
			// Disconnected ports are removed by their disconnect listener.
		}
	}
}
