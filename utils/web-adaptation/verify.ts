import { createExtractedRegionMatcher } from "./extracted-regions";

export type ExtractionSample = { text: string; element: Element };

const compact = (value: string) => value.replace(/\s+/g, "").toLowerCase();

const CHROME_SELECTOR =
	"nav, header, footer, aside, [role='navigation'], [role='banner'], [role='contentinfo']";
const CHROME_NAME =
	/(?:^|[\s_-])(?:nav|menu|sidebar|toc|breadcrumb|a11y)(?:$|[\s_-])/i;

function isSafeRemoval(
	element: Element,
	retainedMainRoots: Element[],
): boolean {
	if (element.closest(CHROME_SELECTOR)) return true;
	if (
		retainedMainRoots.length === 0 ||
		element.closest("main, article, [role='main']")
	)
		return false;
	for (
		let current: Element | null = element;
		current;
		current = current.parentElement
	) {
		if (retainedMainRoots.some((root) => current?.contains(root))) continue;
		const className =
			typeof current.className === "string" ? current.className : "";
		if (
			CHROME_NAME.test(`${current.id} ${className}`) &&
			current.querySelector("a, button, [role='link']")
		)
			return true;
	}
	return false;
}

export function improvesExtraction(
	baseline: ExtractionSample[],
	candidate: ExtractionSample[],
	untranslatedCandidates: ExtractionSample[] = [],
	requireUntranslatedAddition = false,
	scope?: Element[],
): boolean {
	if (candidate.length === 0) return false;
	const before = compact(baseline.map((item) => item.text).join(""));
	const after = compact(candidate.map((item) => item.text).join(""));
	const inBaseline = createExtractedRegionMatcher(baseline, compact);
	const inCandidate = createExtractedRegionMatcher(candidate, compact);
	const retainedMainRoots = [
		...new Set(
			candidate
				.map((item) => item.element.closest("main, article, [role='main']"))
				.filter((element): element is Element => Boolean(element)),
		),
	];
	// A patch that changes the traversal boundary can drop content that was
	// never sampled, so every baseline sample that is still on the page but now
	// sits outside the candidate roots has to look like page chrome.
	if (scope && scope.length > 0) {
		const outOfScope = baseline.filter(
			(item) =>
				item.element.isConnected &&
				!scope.some(
					(root) => root === item.element || root.contains(item.element),
				),
		);
		if (
			outOfScope.some((item) => !isSafeRemoval(item.element, retainedMainRoots))
		)
			return false;
	}
	const addedUntranslatedCandidate = untranslatedCandidates.some(
		(sample) =>
			inCandidate(sample) &&
			!inBaseline(sample) &&
			!isSafeRemoval(sample.element, retainedMainRoots),
	);
	if (requireUntranslatedAddition && !addedUntranslatedCandidate) return false;
	// Equal text elsewhere does not prove this region was already extracted.
	const addedSamples = candidate.filter((item) => !inBaseline(item));
	if (
		addedSamples.some((item) => isSafeRemoval(item.element, retainedMainRoots))
	)
		return false;
	if (
		addedSamples.some(
			(item) =>
				!untranslatedCandidates.some(
					(sample) =>
						compact(item.text) === compact(sample.text) &&
						(item.element === sample.element ||
							item.element.contains(sample.element) ||
							sample.element.contains(item.element)),
				),
		)
	)
		return false;
	if (baseline.length === 0) return addedUntranslatedCandidate;
	const removed = baseline.filter((item) => !inCandidate(item));
	const unsafeRemoved = removed.some(
		(item) => !isSafeRemoval(item.element, retainedMainRoots),
	);
	if (unsafeRemoved) return false;
	const lessFragmented =
		candidate.length < baseline.length &&
		before.length > 0 &&
		after.length >= before.length * 0.9 &&
		after.length <= before.length * 1.2;
	return addedUntranslatedCandidate || lessFragmented || removed.length > 0;
}
