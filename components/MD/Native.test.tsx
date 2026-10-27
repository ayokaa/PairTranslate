import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { KatexOptions } from "katex";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";

let failRender = false;
let moduleLoads = 0;
const renderKatex = mock(
	(content: string, target: HTMLElement, _options?: KatexOptions) => {
		if (failRender) throw new Error("Controlled rendering failure");
		target.textContent = `rendered:${content}`;
	},
);

mock.module("katex/dist/katex.js", () => {
	moduleLoads++;
	return { default: { render: renderKatex }, render: renderKatex };
});

const { default: NativeMapping } = await import("./Native");
const moduleLoadsOnImport = moduleLoads;
const MathComponent = NativeMapping().math;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

let host: HTMLDivElement;
let dispose: (() => void) | undefined;
const originalMode = Object.getOwnPropertyDescriptor(document, "compatMode");

const setMode = (mode: "CSS1Compat" | "BackCompat") => {
	Object.defineProperty(document, "compatMode", {
		configurable: true,
		value: mode,
	});
};

beforeEach(() => {
	failRender = false;
	renderKatex.mockClear();
	setMode("CSS1Compat");
	host = document.createElement("div");
	document.body.appendChild(host);
});

afterEach(() => {
	dispose?.();
	dispose = undefined;
	host.remove();
	if (originalMode) {
		Object.defineProperty(document, "compatMode", originalMode);
	} else {
		Reflect.deleteProperty(document, "compatMode");
	}
});

describe("math rendering compatibility", () => {
	test("importing native components does not initialize KaTeX", () => {
		expect(moduleLoadsOnImport).toBe(0);
	});

	test("keeps inline source in quirks mode without loading KaTeX", async () => {
		setMode("BackCompat");
		const loadsBefore = moduleLoads;
		dispose = render(() => <MathComponent content="x < y" />, host);
		await settle();

		expect(host.textContent).toBe("$x < y$");
		expect(moduleLoads).toBe(loadsBefore);
		expect(renderKatex).not.toHaveBeenCalled();
	});

	test("keeps display math source and layout in quirks mode", async () => {
		setMode("BackCompat");
		dispose = render(() => <MathComponent content="x+1" center />, host);
		await settle();

		expect(host.textContent).toBe("$$\nx+1\n$$");
		expect((host.firstElementChild as HTMLElement).style.display).toBe("block");
		expect(renderKatex).not.toHaveBeenCalled();
	});

	test("renders standard-mode inline math with the existing options", async () => {
		dispose = render(() => <MathComponent content="x+1" />, host);
		await settle();

		expect(host.textContent).toBe("rendered:x+1");
		expect(renderKatex).toHaveBeenCalledWith("x+1", host.firstElementChild, {
			throwOnError: false,
			strict: false,
			displayMode: undefined,
		});
	});

	test("renders standard-mode display math with the existing options", async () => {
		dispose = render(() => <MathComponent content="x+1" center />, host);
		await settle();

		expect(host.textContent).toBe("rendered:x+1");
		expect(renderKatex.mock.calls[0]?.[2]?.displayMode).toBe(true);
	});

	test("preserves source when the renderer throws", async () => {
		failRender = true;
		dispose = render(() => <MathComponent content="x+1" />, host);
		await settle();

		expect(host.textContent).toBe("$x+1$");
	});

	test("tracks content changes synchronously", () => {
		const [content, setContent] = createSignal("old");
		dispose = render(() => <MathComponent content={content()} />, host);
		setContent("new");

		expect(host.textContent).toBe("rendered:new");
		expect(renderKatex.mock.calls.map((call) => call[0])).toEqual([
			"old",
			"new",
		]);
	});

	test("clears a rendered formula on unmount", () => {
		dispose = render(() => <MathComponent content="x+1" />, host);
		const target = host.firstElementChild;
		dispose();
		dispose = undefined;

		expect(target?.textContent).toBe("");
	});

	test("clearing content removes the formula", () => {
		const [content, setContent] = createSignal<string | undefined>("x+1");
		dispose = render(() => <MathComponent content={content()} />, host);
		setContent(undefined);

		expect(host.textContent).toBe("");
		expect(renderKatex).toHaveBeenCalledTimes(1);
	});

	test("updates an already rendered formula", async () => {
		const [content, setContent] = createSignal("x+1");
		dispose = render(() => <MathComponent content={content()} />, host);
		await settle();
		setContent("y+2");
		await settle();

		expect(host.textContent).toBe("rendered:y+2");
	});

	test("a local rendering failure preserves neighboring text", async () => {
		failRender = true;
		dispose = render(
			() => (
				<>
					<span>First translation.Before </span>
					<MathComponent content="x+1" />
					<span> after.Last translation.</span>
				</>
			),
			host,
		);
		await settle();

		expect(host.textContent).toBe(
			"First translation.Before $x+1$ after.Last translation.",
		);
	});
});
