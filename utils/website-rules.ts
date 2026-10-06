import { makeDomainMatcher } from "./domain-matcher";
import type { WebsiteRulesSettings } from "./settings/def";

/**
 * Resolve the index of the website rule that governs a given domain, using the
 * same "lowest matching pattern wins" rule as the background match service.
 *
 * Callers that render UI (e.g. the popup) should prefer this over the
 * `matchWebsiteRule` RPC: the background service rebuilds its matcher from
 * `browser.storage` change events, so it lags one storage sync behind a rule
 * that has just been written. Resolving locally keeps the UI consistent with
 * the data on the very same tick the settings change.
 *
 * @returns the governing rule index, or `null` when nothing matches.
 */
export const findWebsiteRuleIndex = (
	websiteRules: WebsiteRulesSettings,
	domain: string,
): number | null => {
	if (websiteRules.length === 0 || !domain) {
		return null;
	}

	const patterns = websiteRules.flatMap((rule) => rule.urlPatterns);
	const patternIndexToRuleIndex = websiteRules.flatMap((rule, index) =>
		rule.urlPatterns.map(() => index),
	);

	const matchedPatternIndex = makeDomainMatcher(patterns)(domain);
	if (matchedPatternIndex === null) {
		return null;
	}

	return patternIndexToRuleIndex[matchedPatternIndex] ?? null;
};
