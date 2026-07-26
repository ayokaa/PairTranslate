import { mock } from "bun:test";
import { transformSync } from "@babel/core";
// @ts-expect-error - babel-preset-solid ships no types
import presetSolid from "babel-preset-solid";
import { plugin } from "bun";

/**
 * Compiles Solid JSX for `bun test` and stubs the WXT virtual modules so
 * component code can be rendered against the linkedom DOM in `dom-setup.ts`.
 */

// Bun applies the "node" export condition, which resolves Solid to its server
// builds: the renderer emits strings and the client-only APIs throw. Pin the
// browser builds so a plain `bun test` renders components.
for (const [specifier, browserBuild] of [
	["solid-js", "solid-js/dist/solid.js"],
	["solid-js/web", "solid-js/web/dist/web.js"],
	["solid-js/store", "solid-js/store/dist/store.js"],
] as const) {
	const module = await import(browserBuild);
	mock.module(specifier, () => ({ ...module }));
}

mock.module("#imports", () => ({
	browser: {
		i18n: { getUILanguage: () => "en" },
		runtime: { id: "test", getURL: (path: string) => path },
	},
	defineContentScript: (config: unknown) => config,
	defineBackground: (config: unknown) => config,
}));

plugin({
	name: "solid-jsx",
	setup(build) {
		build.onLoad({ filter: /\.tsx$/ }, async (args) => {
			const source = await Bun.file(args.path).text();
			const result = transformSync(source, {
				filename: args.path,
				presets: [[presetSolid, {}]],
				// Keep the type annotations in the output and let Bun's "ts" loader
				// strip them; @babel/preset-typescript is not installed.
				parserOpts: { plugins: ["typescript", "jsx", "decorators-legacy"] },
				babelrc: false,
				configFile: false,
			});
			return { contents: result?.code ?? source, loader: "ts" };
		});
	},
});
