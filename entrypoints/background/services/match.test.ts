import { expect, mock, test } from "bun:test";

mock.module("~/utils/settings/helper", () => ({
	listenSettings: (callback: (settings: unknown) => void) => {
		callback({
			websiteRules: [
				{ urlPatterns: ["one.example", "first.example"] },
				{ urlPatterns: ["two.example"] },
				{ urlPatterns: ["three.example", "last.example"] },
			],
		});
	},
}));

const { createMatchService } = await import("./match");

test("website pattern indices map back to their parent rules", async () => {
	const service = createMatchService();
	expect(await service.matchWebsiteRule("first.example")).toBe(0);
	expect(await service.matchWebsiteRule("two.example")).toBe(1);
	expect(await service.matchWebsiteRule("last.example")).toBe(2);
});
