import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createStore } from "solid-js/store";
import type {
	PopupActions,
	PopupCallbacks,
} from "~/entrypoints/content/components/Popup";
import { STORAGE_KEYS } from "~/utils/constants";

const localStore = new Map<string, unknown>();
let messageListeners: Array<(message: unknown) => void> = [];

const mockBrowser = {
	storage: {
		local: {
			get: async (keys: string | string[]) => {
				const keyList = Array.isArray(keys) ? keys : [keys];
				const result: Record<string, unknown> = {};
				for (const k of keyList) {
					if (localStore.has(k)) result[k] = localStore.get(k);
				}
				return result;
			},
			set: async (items: Record<string, unknown>) => {
				for (const [k, v] of Object.entries(items)) localStore.set(k, v);
			},
			remove: async (keys: string | string[]) => {
				const keyList = Array.isArray(keys) ? keys : [keys];
				for (const k of keyList) localStore.delete(k);
			},
		},
	},
	runtime: {
		onMessage: {
			addListener: (fn: (message: unknown) => void) => {
				messageListeners.push(fn);
			},
			removeListener: (fn: (message: unknown) => void) => {
				messageListeners = messageListeners.filter((item) => item !== fn);
			},
		},
	},
};

mock.module("#imports", () => ({ browser: mockBrowser }));
mock.module("@wxt-dev/browser", () => ({ browser: mockBrowser }));

const [settings] = createStore({
	basic: {
		restorePageState: false,
		keyboardShortcutForSummary: "",
		keyboardShortcutEnabled: false,
		keyboardShortcutSummarizes: false,
	},
	summary: {
		summaryModel: "model-1",
		summaryDefaultPinned: false,
		summaryGeometryMaxEntries: 1000,
	},
	websiteRules: [] as Array<{ enableSummary?: boolean; urlPatterns: string[] }>,
});

mock.module("~/hooks/settings", () => ({
	useSettings: () => ({ settings }),
}));

mock.module("~/hooks/keyboard-shortcut", () => ({
	createKeyboardShortcut: () => {},
}));

mock.module("~/utils/i18n", () => ({
	t: (key: string) => key,
}));

mock.module("~/utils/page-context", () => ({
	getPageContext: () => ({
		url: "https://example.com/article",
		title: "Article",
	}),
}));

mock.module("~/utils/page-state", () => ({
	loadPageState: async () => null,
	savePageState: async () => {},
}));

mock.module("~/utils/summary/extract", () => ({
	extractPageContent: () => ({
		content: "Article body content",
		truncated: false,
	}),
}));

mock.module("./SummaryPanel", () => ({
	default: () => null,
}));

type RecordedPopup = {
	x: number;
	y: number;
	width: number;
	height: number;
	visible: boolean;
	callbacks?: PopupCallbacks;
};

let activePopups: RecordedPopup[] = [];

mock.module("~/entrypoints/content/components/Popup", () => ({
	usePopup: () => ({
		addPopup: (
			inputState?: Partial<RecordedPopup>,
			callbacks?: PopupCallbacks,
		): PopupActions => {
			const record: RecordedPopup = {
				x: inputState?.x ?? 12,
				y: inputState?.y ?? 12,
				width: inputState?.width ?? 320,
				height: inputState?.height ?? 480,
				visible: true,
				callbacks,
			};
			activePopups.push(record);
			return {
				togglePin: () => {},
				close: () => {
					record.visible = false;
				},
				setPosition: (x: number, y: number) => {
					record.x = x;
					record.y = y;
				},
				setSize: (width: number, height: number) => {
					record.width = width;
					record.height = height;
				},
				setGeometry: (x: number, y: number, width: number, height: number) => {
					record.x = x;
					record.y = y;
					record.width = width;
					record.height = height;
				},
				isVisible: () => record.visible,
			};
		},
	}),
}));

const { render } = await import("solid-js/web");
const { loadPopupGeometry, savePopupGeometry } = await import(
	"~/utils/summary/popup-storage"
);
const { default: SummaryHost } = await import("./SummaryHost");

const flushMicrotasks = async () => {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
};

type FakeWindow = {
	innerWidth: number;
	innerHeight: number;
	location: { href: string; hostname: string };
	addEventListener: (
		type: string,
		listener: () => void,
		options?: AddEventListenerOptions,
	) => void;
	removeEventListener: (type: string, listener: () => void) => void;
	resizeTo: (width: number, height: number) => void;
};

function createFakeWindow(width: number, height: number): FakeWindow {
	const listeners = new Map<string, Set<() => void>>();
	const win: FakeWindow = {
		innerWidth: width,
		innerHeight: height,
		location: {
			href: "https://example.com/article",
			hostname: "example.com",
		},
		addEventListener(type, listener) {
			let set = listeners.get(type);
			if (!set) {
				set = new Set();
				listeners.set(type, set);
			}
			set.add(listener);
		},
		removeEventListener(type, listener) {
			listeners.get(type)?.delete(listener);
		},
		resizeTo(nextWidth, nextHeight) {
			win.innerWidth = nextWidth;
			win.innerHeight = nextHeight;
			for (const listener of listeners.get("resize") ?? []) {
				listener();
			}
		},
	};
	return win;
}

let fakeWindow: FakeWindow;
let host: HTMLDivElement;
let dispose: (() => void) | undefined;
const originalWindow = globalThis.window;

const triggerSummary = () => {
	for (const listener of [...messageListeners]) {
		listener({ type: "generate-summary" });
	}
};

beforeEach(() => {
	localStore.clear();
	messageListeners = [];
	activePopups = [];
	fakeWindow = createFakeWindow(1920, 1080);
	Object.assign(globalThis, { window: fakeWindow });
	host = document.createElement("div");
	document.body.append(host);
});

afterEach(() => {
	dispose?.();
	dispose = undefined;
	host.remove();
	Object.assign(globalThis, { window: originalWindow });
});

describe("SummaryHost viewport persistence and auto-scaling", () => {
	test("scales saved geometry on open and live-rescales on window resize without drift", async () => {
		await savePopupGeometry(
			{
				x: 1400,
				y: 400,
				width: 420,
				height: 520,
				viewportWidth: 1920,
				viewportHeight: 1080,
			},
			"https://example.com/article",
		);

		fakeWindow.innerWidth = 960;
		fakeWindow.innerHeight = 540;
		dispose = render(() => <SummaryHost />, host);
		await flushMicrotasks();

		triggerSummary();
		expect(activePopups).toHaveLength(1);
		expect(activePopups[0]).toMatchObject({
			x: 700,
			y: 200,
			width: 210,
			height: 260,
		});

		// Shrink further until hitting MIN_WIDTH (200)
		fakeWindow.resizeTo(600, 400);
		expect(activePopups[0].width).toBe(200);
		expect(activePopups[0].x + activePopups[0].width).toBeLessThanOrEqual(
			600 - 12,
		);

		// Restore to original 1920x1080: exact original geometry comes back
		fakeWindow.resizeTo(1920, 1080);
		expect(activePopups[0]).toMatchObject({
			x: 1400,
			y: 400,
			width: 420,
			height: 520,
		});

		// Browser resizes alone must not overwrite persisted storage
		expect(await loadPopupGeometry("https://example.com/article")).toEqual({
			x: 1400,
			y: 400,
			width: 420,
			height: 520,
			viewportWidth: 1920,
			viewportHeight: 1080,
		});
	});

	test("persists current viewport size on user move/resize after browser resize", async () => {
		await savePopupGeometry(
			{
				x: 1400,
				y: 400,
				width: 420,
				height: 520,
				viewportWidth: 1920,
				viewportHeight: 1080,
			},
			"https://example.com/article",
		);

		dispose = render(() => <SummaryHost />, host);
		await flushMicrotasks();

		triggerSummary();
		fakeWindow.resizeTo(960, 540);
		expect(activePopups[0]).toMatchObject({
			x: 700,
			y: 200,
			width: 210,
			height: 260,
		});

		// User drags the scaled popup at 960x540 — must save scaled width/height + 960x540 viewport
		activePopups[0].callbacks?.onMoveEnd?.(100, 80);
		await flushMicrotasks();

		expect(await loadPopupGeometry("https://example.com/article")).toEqual({
			x: 100,
			y: 80,
			width: 210,
			height: 260,
			viewportWidth: 960,
			viewportHeight: 540,
		});

		// Subsequent resize scales from the newly saved 960x540 reference
		fakeWindow.resizeTo(1920, 1080);
		expect(activePopups[0]).toMatchObject({
			x: 200,
			y: 160,
			width: 420,
			height: 520,
		});
	});

	test("adapts legacy saved geometry without viewport size and scales live resizes", async () => {
		localStore.set(STORAGE_KEYS.summaryPopupGeometry, {
			"example.com": {
				x: 100,
				y: 120,
				width: 400,
				height: 500,
				updatedAt: Date.now(),
			},
		});

		fakeWindow.innerWidth = 1000;
		fakeWindow.innerHeight = 800;
		dispose = render(() => <SummaryHost />, host);
		await flushMicrotasks();

		triggerSummary();
		expect(activePopups[0]).toMatchObject({
			x: 100,
			y: 120,
			width: 400,
			height: 500,
		});

		fakeWindow.resizeTo(500, 400);
		expect(activePopups[0]).toMatchObject({
			x: 50,
			y: 60,
			width: 200,
			height: 250,
		});
	});

	test("does not update closed popup on resize and rescales when reopened", async () => {
		await savePopupGeometry(
			{
				x: 1400,
				y: 400,
				width: 420,
				height: 520,
				viewportWidth: 1920,
				viewportHeight: 1080,
			},
			"https://example.com/article",
		);

		dispose = render(() => <SummaryHost />, host);
		await flushMicrotasks();

		triggerSummary();
		const first = activePopups[0];
		first.visible = false;

		fakeWindow.resizeTo(960, 540);
		expect(first).toMatchObject({
			x: 1400,
			y: 400,
			width: 420,
			height: 520,
		});

		triggerSummary();
		expect(activePopups).toHaveLength(2);
		expect(activePopups[1]).toMatchObject({
			x: 700,
			y: 200,
			width: 210,
			height: 260,
		});
	});
});
