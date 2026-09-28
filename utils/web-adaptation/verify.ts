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
): boolean {
	if (candidate.length === 0) return false;
	const before = compact(baseline.map((item) => item.text).join(""));
	const after = compact(candidate.map((item) => item.text).join(""));
	const retainedMainRoots = [
		...new Set(
			candidate
				.map((item) => item.element.closest("main, article, [role='main']"))
				.filter((element): element is Element => Boolean(element)),
		),
	];
	const relatedSamplesContain = (
		samples: ExtractionSample[],
		expected: ExtractionSample,
	) => {
		const relatedText = compact(
			samples
				.filter(
					(item) =>
						item.element === expected.element ||
						item.element.contains(expected.element) ||
						expected.element.contains(item.element),
				)
				.map((item) => item.text)
				.join(""),
		);
		return relatedText.includes(compact(expected.text));
	};
	const addedUntranslatedCandidate = untranslatedCandidates.some(
		(sample) =>
			relatedSamplesContain(candidate, sample) &&
			!relatedSamplesContain(baseline, sample) &&
			!isSafeRemoval(sample.element, retainedMainRoots),
	);
	if (requireUntranslatedAddition && !addedUntranslatedCandidate) return false;
	const addedSamples = candidate.filter(
		(item) => !before.includes(compact(item.text)),
	);
	if (
		addedSamples.some((item) => isSafeRemoval(item.element, retainedMainRoots))
	)
		return false;
	if (
		requireUntranslatedAddition &&
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
	const removed = baseline.filter(
		(item) => !after.includes(compact(item.text)),
	);
	const unsafeRemoved = removed.some(
		(item) => !isSafeRemoval(item.element, retainedMainRoots),
	);
	if (unsafeRemoved) return false;
	const added =
		addedUntranslatedCandidate ||
		(addedSamples.length > 0 && untranslatedCandidates.length === 0);
	const lessFragmented =
		candidate.length < baseline.length &&
		before.length > 0 &&
		after.length >= before.length * 0.9 &&
		after.length <= before.length * 1.2;
	return added || lessFragmented || removed.length > 0;
}
