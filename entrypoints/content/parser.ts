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
	adaptationRulesEqual,
	findAdaptationRule,
	parseAdaptationRules,
} from "~/utils/web-adaptation/model";
import {
	getLastStructureIdentity,
	getLegacyStructureKey,
	getStructureKey,
	setLastStructureKey,
} from "~/utils/web-adaptation/structure";

// Suppress duplicate removal requests for one saved version. An updated rule
// can be inspected again, and an old scan must never delete its replacement.
const droppedStaleRules = new Map<string, AdaptationRule>();

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
	const structureKey = getStructureKey(document);
	const pathname = window.location.pathname;
	const previous = getLastStructureIdentity(document, pathname);
	const legacyStructureKey =
		previous?.key === structureKey && previous.legacyKey
			? previous.legacyKey
			: savedRules.some(
						(rule) =>
							rule.hostname === domain &&
							!rule.structureKey.startsWith("layout:"),
					)
				? getLegacyStructureKey(document)
				: undefined;
	if (options.recordStructureKey !== false) {
		setLastStructureKey(document, structureKey, pathname, legacyStructureKey);
	}
	const matchedRule = overridePatch
		? undefined
		: findAdaptationRule(savedRules, domain, pathname, structureKey, {
				legacyStructureKey,
			});
	const patch = overridePatch ?? matchedRule?.patch;
	if (
		options.recordStructureKey !== false &&
		matchedRule &&
		!adaptationRulesEqual(droppedStaleRules.get(matchedRule.id), matchedRule) &&
		hasStaleAdaptationRoots(patch, document)
	) {
		// The page no longer matches the saved boundary. Keep translating with
		// the default scan and drop the rule instead of silently stopping.
		droppedStaleRules.set(matchedRule.id, matchedRule);
		const releaseRemoval = () => {
			if (droppedStaleRules.get(matchedRule.id) === matchedRule)
				droppedStaleRules.delete(matchedRule.id);
		};
		console.warn(
			"[pair-translate] web adaptation rule no longer matches this page; removing it and restoring the default scan",
		);
		// Removing a stale rule is best effort: the fallback scan already keeps
		// the page translated. The RPC client hands back a thenable rather than
		// a Promise, so `.catch()` cannot be called on it directly; and a failure
		// here must never escape, or the caller's listener is never created and
		// the whole page stops translating.
		try {
			void Promise.resolve(
				window.rpc.deleteWebAdaptationRule(matchedRule.id, matchedRule),
			).then((removed) => {
				if (!removed) releaseRemoval();
			}, releaseRemoval);
		} catch {
			releaseRemoval();
		}
	}
	return listener(applyAdaptationPatch(options, patch, document));
};
