import {
	checkLanguageDetectorSupport,
	createBrowserLanguageDetector,
} from "./browser-translator";

let _detector: Awaited<
	ReturnType<typeof createBrowserLanguageDetector>
> | null = null;
let _detectorInit: Promise<void> | null = null;

async function ensureDetector() {
	if (_detector) return _detector;
	if (_detectorInit) {
		await _detectorInit;
		return _detector;
	}
	_detectorInit = (async () => {
		const support = await checkLanguageDetectorSupport();
		if (support.isSupported && support.availability !== "unavailable") {
			_detector = await createBrowserLanguageDetector();
		}
	})();
	await _detectorInit;
	return _detector;
}

/**
 * Detect the source language of the given text using a fast, local
 * detector (Chrome's LanguageDetector API). Returns null when the
 * detector is unavailable in the current browser/context, when the
 * text is empty, or when detection itself fails — callers should
 * treat null as "fall back to the configured service's auto behavior".
 */
export async function detectSourceLanguage(
	text: string,
): Promise<string | null> {
	if (!text || text.trim().length === 0) return null;
	const detector = await ensureDetector();
	if (!detector) return null;
	try {
		const results = await detector.detect(text);
		return results[0]?.detectedLanguage ?? null;
	} catch {
		return null;
	}
}
