import { DEFAULT_DOM_LISTENER, PARSER_LIST } from "~/utils/parser";
import type { Options, SectionGenerator } from "~/utils/parser/types";
import { getSettings } from "~/utils/settings/helper";
import {
	applyAdaptationPatch,
	hasStaleAdaptationRoots,
} from "~/utils/web-adaptation/apply";
import {
	type AdaptationPatch,
	type AdaptationRule,
	findAdaptationRule,
	parseAdaptationRules,
} from "~/utils/web-adaptation/model";
import { getStructureKey } from "~/utils/web-adaptation/structure";

// A stale rule is reported once per content script lifetime; the storage change
// itself re-triggers the parser with the rule already gone.
const droppedStaleRules = new Set<string>();

export const getDomListener = async (
	domain: string,
	options: Options = {},
	rules?: AdaptationRule[],
	overridePatch?: AdaptationPatch,
): Promise<SectionGenerator> => {
	const idx = await window.rpc.matchParser(domain);
	const listener =
		idx === null ? DEFAULT_DOM_LISTENER : PARSER_LIST[idx].domListener;
	const savedRules = parseAdaptationRules(
		rules ?? (await getSettings()).webAdaptation.rules,
	);
	const matchedRule = overridePatch
		? undefined
		: findAdaptationRule(
				savedRules,
				domain,
				window.location.pathname,
				getStructureKey(document),
			);
	const patch = overridePatch ?? matchedRule?.patch;
	if (
		matchedRule &&
		!droppedStaleRules.has(matchedRule.id) &&
		hasStaleAdaptationRoots(patch, document)
	) {
		// The page no longer matches the saved boundary. Keep translating with
		// the default scan and drop the rule instead of silently stopping.
		droppedStaleRules.add(matchedRule.id);
		console.warn(
			"[pair-translate] web adaptation rule no longer matches this page; removing it and restoring the default scan",
		);
		void window.rpc.deleteWebAdaptationRule(matchedRule.id).catch(() => {
			// Removing a stale rule is best effort: the fallback scan already
			// keeps the page translated.
		});
	}
	return listener(applyAdaptationPatch(options, patch, document));
};
