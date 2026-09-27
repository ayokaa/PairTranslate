import { DEFAULT_DOM_LISTENER, PARSER_LIST } from "~/utils/parser";
import type { Options, SectionGenerator } from "~/utils/parser/types";
import { getSettings } from "~/utils/settings/helper";
import { applyAdaptationPatch } from "~/utils/web-adaptation/apply";
import {
	type AdaptationPatch,
	type AdaptationRule,
	findAdaptationRule,
} from "~/utils/web-adaptation/model";
import { getStructureKey } from "~/utils/web-adaptation/structure";

export const getDomListener = async (
	domain: string,
	options: Options = {},
	rules?: AdaptationRule[],
	overridePatch?: AdaptationPatch,
): Promise<SectionGenerator> => {
	const idx = await window.rpc.matchParser(domain);
	const listener =
		idx === null ? DEFAULT_DOM_LISTENER : PARSER_LIST[idx].domListener;
	const savedRules = rules ?? (await getSettings()).webAdaptation.rules;
	const patch =
		overridePatch ??
		findAdaptationRule(
			savedRules,
			domain,
			window.location.pathname,
			getStructureKey(document),
		)?.patch;
	return listener(applyAdaptationPatch(options, patch, document));
};
