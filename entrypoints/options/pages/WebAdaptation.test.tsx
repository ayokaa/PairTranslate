import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createStore } from "solid-js/store";
import type { AdaptationRule } from "~/utils/web-adaptation/model";

const [settings, setSettings] = createStore({
	services: {},
	webAdaptation: {
		autoEnabled: false,
		modelId: undefined,
		rules: [] as AdaptationRule[],
	},
});
mock.module("~/hooks/settings", () => ({
	useSettings: () => ({ settings, setSettings }),
}));
// linkedom exposes select.value as read-only. The existing model picker is
// outside this grouping test; rule toggles and delete controls remain real.
mock.module("~/components/Select", () => ({ Select: () => null }));
const translate = (key: string, args?: string[]) =>
	args ? `${key}(${args.join(",")})` : key;
mock.module("~/utils/i18n", () => ({ t: translate, i18n: { t: translate } }));
const { render } = await import("solid-js/web");
const { default: WebAdaptation } = await import("./WebAdaptation");
const DomEvent = (
	document as unknown as { defaultView: { Event: typeof Event } }
).defaultView.Event;
let host: HTMLDivElement;
let dispose: (() => void) | undefined;

function rule(hostname: string, pathname: string): AdaptationRule {
	return {
		id: crypto.randomUUID(),
		hostname,
		pathPatterns: [pathname],
		structureKey: "layout:abc12345",
		enabled: true,
		source: "manual",
		patch: { roots: [], excludes: ["nav"], includes: [], promoteTags: [] },
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
}

function toggleFor(pathname: string): HTMLInputElement {
	const toggle = [
		...host.querySelectorAll<HTMLInputElement>("input[aria-label]"),
	].find((input) => input.getAttribute("aria-label")?.includes(pathname));
	if (!toggle) throw new Error("Rule toggle was not rendered");
	return toggle;
}

beforeEach(() => {
	document.body.replaceChildren();
	Object.assign(globalThis, { window: { document, confirm: () => true } });
	// Interleave two hosts: grouped row indexes must never address the global list.
	setSettings("webAdaptation", "rules", [
		rule("example.com", "/blog/first"),
		rule("other.example", "/article"),
		rule("example.com", "/blog/second"),
	]);
	host = document.createElement("div");
	document.body.append(host);
	dispose = render(() => <WebAdaptation navId="adaptation" />, host);
});

afterEach(() => {
	dispose?.();
	host.remove();
});

test("groups one hostname once and keeps rule toggles bound to their own IDs", () => {
	expect(host.querySelectorAll("section[aria-label]")).toHaveLength(2);
	expect(
		host.querySelector('section[aria-label="example.com"]')?.textContent,
	).toContain("ruleCount(2)");
	const toggle = toggleFor("/blog/second");
	toggle.checked = false;
	toggle.dispatchEvent(new DomEvent("change", { bubbles: true }));
	expect(settings.webAdaptation.rules.map((item) => item.enabled)).toEqual([
		true,
		true,
		false,
	]);
	setSettings(
		"webAdaptation",
		"rules",
		(item) => item.pathPatterns.includes("/blog/first"),
		"enabled",
		false,
	);
	expect(toggleFor("/blog/first").checked).toBe(false);
});

test("deleting a grouped rule preserves other scopes and updates groups reactively", () => {
	const toggle = toggleFor("/blog/second");
	const row = toggle.closest("div.rounded-xl");
	row
		?.querySelector("button")
		?.dispatchEvent(new DomEvent("click", { bubbles: true }));
	expect(settings.webAdaptation.rules.map((item) => item.pathPatterns)).toEqual(
		[["/blog/first"], ["/article"]],
	);
	expect(
		host.querySelector('section[aria-label="example.com"]')?.textContent,
	).toContain("ruleCount(1)");
	setSettings("webAdaptation", "rules", (items) =>
		items.filter((item) => item.hostname !== "example.com"),
	);
	expect(host.querySelector('section[aria-label="example.com"]')).toBeNull();
	expect(toggleFor("/article")).toBeTruthy();
	setSettings("webAdaptation", "rules", []);
	expect(host.textContent).toContain("settings.webAdaptation.noRules");
});
