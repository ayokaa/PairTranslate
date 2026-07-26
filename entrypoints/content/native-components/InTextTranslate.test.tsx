import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("~/utils/animate", () => ({ animate: () => Promise.resolve() }));
mock.module("~/utils/i18n", () => ({
	i18n: { t: (key: string) => key },
	t: (key: string) => key,
}));

// linkedom ships neither MouseEvent nor TouchEvent, which matches desktop
// Firefox: TouchEvent is undefined there unless touch support is enabled.
const DomEvent = (
	document as unknown as { defaultView: { Event: typeof Event } }
).defaultView.Event;

class TestMouseEvent extends DomEvent {
	clientX: number;
	clientY: number;

	constructor(type: string, init?: { clientX?: number; clientY?: number }) {
		super(type);
		this.clientX = init?.clientX ?? 0;
		this.clientY = init?.clientY ?? 0;
	}
}

// Mirror desktop Firefox: MouseEvent exists, TouchEvent does not.
Object.assign(globalThis, {
	MouseEvent: TestMouseEvent,
	window: {
		innerWidth: 1024,
		innerHeight: 768,
		document,
		addEventListener: () => {},
		removeEventListener: () => {},
	},
});
(
	Element.prototype as unknown as { getBoundingClientRect: () => DOMRect }
).getBoundingClientRect = () =>
	({ x: 0, y: 0, width: 40, height: 90, left: 0, top: 0 }) as DOMRect;

const { render } = await import("solid-js/web");
const { createSignal } = await import("solid-js");
const { TranslationRender } = await import("./InTextTranslate");

interface Harness {
	menuVisible: () => boolean;
	trigger: () => HTMLElement | null;
	setError: (message: string | undefined) => void;
	setLoading: (loading: boolean) => void;
}

const mount = (showTranslationActions: boolean): Harness => {
	const host = document.createElement("div");
	document.body.appendChild(host);

	const paragraph = document.createElement("p");
	const textNode = document.createTextNode("Hello world");
	paragraph.appendChild(textNode);
	document.body.appendChild(paragraph);

	const [error, setError] = createSignal<string | undefined>(undefined);
	const [loading, setLoading] = createSignal(true);

	render(
		() => (
			<TranslationRender
				text={undefined}
				loading={loading()}
				skipped={false}
				error={error()}
				hideOriginal={false}
				section={[textNode, textNode] as const}
				showLanguageIcon={true}
				showTranslationActions={showTranslationActions}
			/>
		),
		host,
	);

	return {
		menuVisible: () => !!host.querySelector("ul"),
		trigger: () => paragraph.querySelector("button"),
		setError,
		setLoading,
	};
};

const fail = (harness: Harness) => {
	harness.setLoading(false);
	harness.setError("Network unreachable");
};

describe("in-text translation error state", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	test("keeps the error icon interactive when the action menu is off", () => {
		const harness = mount(false);
		fail(harness);

		expect(harness.trigger()).toBeTruthy();
	});

	test.each([
		[
			"mouseenter",
			() => new TestMouseEvent("mouseenter", { clientX: 100, clientY: 100 }),
		],
		[
			"click",
			() => new TestMouseEvent("click", { clientX: 100, clientY: 100 }),
		],
		["focus", () => new DomEvent("focus")],
	])("opens the retry menu on %s without a global TouchEvent", (_name, make) => {
		expect(globalThis).not.toHaveProperty("TouchEvent");

		const harness = mount(false);
		fail(harness);

		harness.trigger()?.dispatchEvent(make());

		expect(harness.menuVisible()).toBe(true);
	});

	test("recovering from an error closes a menu that can no longer render", () => {
		const harness = mount(false);
		fail(harness);

		harness
			.trigger()
			?.dispatchEvent(
				new TestMouseEvent("mouseenter", { clientX: 10, clientY: 10 }),
			);
		expect(harness.menuVisible()).toBe(true);

		// Retrying clears the error; with the action menu off the tooltip can no
		// longer render, so its position must be dropped along with it.
		harness.setError(undefined);
		harness.setLoading(true);
		expect(harness.menuVisible()).toBe(false);

		fail(harness);
		harness
			.trigger()
			?.dispatchEvent(
				new TestMouseEvent("mouseenter", { clientX: 10, clientY: 10 }),
			);

		expect(harness.menuVisible()).toBe(true);
	});
});
