import { describe, expect, test } from "bun:test";
import {
	createFrameTranslationStateMessage,
	FRAME_TRANSLATION_PORT_NAME,
} from "~/utils/frame-translation";
import { FrameTranslationRelay } from "./frame-translation";

type Listener = (...args: never[]) => void;

class MockEvent<T extends Listener> {
	private readonly listeners = new Set<T>();

	addListener = (listener: T) => this.listeners.add(listener);
	removeListener = (listener: T) => this.listeners.delete(listener);
	emit = (...args: Parameters<T>) => {
		for (const listener of this.listeners) listener(...args);
	};
}

class MockPort {
	readonly name = FRAME_TRANSLATION_PORT_NAME;
	readonly sender: { frameId: number; tab: { id: number } };
	readonly onMessage = new MockEvent<(message: unknown) => void>();
	readonly onDisconnect = new MockEvent<() => void>();
	readonly messages: unknown[] = [];

	constructor(tabId: number, frameId: number) {
		this.sender = {
			frameId,
			tab: { id: tabId },
		};
	}

	postMessage = (message: unknown) => this.messages.push(message);
	disconnect = () => this.onDisconnect.emit();
	receive = (message: unknown) => this.onMessage.emit(message);

	asRuntimePort = () =>
		this as unknown as Parameters<FrameTranslationRelay["connect"]>[0];
}

describe("FrameTranslationRelay", () => {
	test("relays top-frame state to existing and late child frames", () => {
		const relay = new FrameTranslationRelay();
		const top = new MockPort(7, 0);
		const child = new MockPort(7, 2);

		relay.connect(top.asRuntimePort());
		relay.connect(child.asRuntimePort());
		expect(child.messages).toEqual([createFrameTranslationStateMessage(false)]);

		top.receive(createFrameTranslationStateMessage(true));
		expect(child.messages.at(-1)).toEqual(
			createFrameTranslationStateMessage(true),
		);

		const lateChild = new MockPort(7, 5);
		relay.connect(lateChild.asRuntimePort());
		expect(lateChild.messages).toEqual([
			createFrameTranslationStateMessage(true),
		]);
	});

	test("ignores child updates and disables children when the top frame exits", () => {
		const relay = new FrameTranslationRelay();
		const top = new MockPort(11, 0);
		const child = new MockPort(11, 1);

		relay.connect(top.asRuntimePort());
		relay.connect(child.asRuntimePort());
		top.receive(createFrameTranslationStateMessage(true));
		child.receive(createFrameTranslationStateMessage(false));
		expect(child.messages.at(-1)).toEqual(
			createFrameTranslationStateMessage(true),
		);

		top.disconnect();
		expect(child.messages.at(-1)).toEqual(
			createFrameTranslationStateMessage(false),
		);
	});

	test("keeps translation state isolated between tabs", () => {
		const relay = new FrameTranslationRelay();
		const topA = new MockPort(21, 0);
		const childA = new MockPort(21, 1);
		const childB = new MockPort(22, 1);

		relay.connect(topA.asRuntimePort());
		relay.connect(childA.asRuntimePort());
		relay.connect(childB.asRuntimePort());
		topA.receive(createFrameTranslationStateMessage(true));

		expect(childA.messages.at(-1)).toEqual(
			createFrameTranslationStateMessage(true),
		);
		expect(childB.messages.at(-1)).toEqual(
			createFrameTranslationStateMessage(false),
		);
	});
});
