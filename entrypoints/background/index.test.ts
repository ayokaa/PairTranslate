import { expect, mock, test } from "bun:test";

const gate = Promise.withResolvers<void>();
const initializeSettings = mock(() => gate.promise);
const createTranslateService = mock(async () => ({}));
const setupWxtServer = mock(() => {});
let receive!: (
	message: string,
	sender: unknown,
	respond: (reply: string) => void,
) => boolean;
mock.module("#imports", () => ({
	defineBackground: (callback: () => void) => callback,
	browser: {
		runtime: {
			id: "test",
			onConnect: { addListener: () => {} },
			onMessage: {
				addListener: (callback: typeof receive) => {
					receive = callback;
				},
			},
		},
		commands: { onCommand: { addListener: () => {} } },
	},
}));
mock.module("~/utils/settings/init", () => ({ initializeSettings }));
mock.module("~/utils/rpc", () => ({ setupWxtServer }));
mock.module("~/utils/translator-window", () => ({
	openTranslatorPopup: async () => {},
}));
mock.module("./services/translate", () => ({ createTranslateService }));
mock.module("./services/style", () => ({ createStyleService: () => ({}) }));
mock.module("./services/match", () => ({ createMatchService: () => ({}) }));
mock.module("./services/dictionary", () => ({
	createDictionaryService: () => ({}),
}));
mock.module("./services/web-adaptation", () => ({
	createWebAdaptationService: () => ({}),
}));
const { default: background } = await import("./index");

test("simultaneous page/frame pings initialize one translation service and one RPC server", async () => {
	(background as unknown as () => void)();
	const responses = Array.from({ length: 3 }, () =>
		Promise.withResolvers<string>(),
	);
	for (const response of responses) receive("ping", {}, response.resolve);
	const inFlightStarts = initializeSettings.mock.calls.length;
	gate.resolve();
	expect(
		await Promise.all(responses.map((response) => response.promise)),
	).toEqual(["pong", "pong", "pong"]);
	expect(inFlightStarts).toBe(1);
	expect(createTranslateService).toHaveBeenCalledTimes(1);
	expect(setupWxtServer).toHaveBeenCalledTimes(1);
	const later = Promise.withResolvers<string>();
	receive("ping", {}, later.resolve);
	expect(await later.promise).toBe("pong");
	expect(initializeSettings).toHaveBeenCalledTimes(1);
});
