import { browser } from "#imports";
import { SUPPORTED_LANGUAGES } from "~/utils/constants";

/**
 * Get the browser's UI language
 */
export function getBrowserLanguage(): string {
	return browser.i18n.getUILanguage();
}

/**
 * Normalize language code to match supported formats
 * Converts "en-US" to "en", "zh-CN" to "zh-CN", etc.
 */
export function normalizeLanguageCode(language: string): string {
	const normalized = language.replace("_", "-");
	const lower = normalized.toLowerCase();
	if (["zh-cn", "zh-sg", "zh-hans"].includes(lower)) return "zh-CN";
	if (["zh-tw", "zh-hk", "zh-mo", "zh-hant"].includes(lower)) return "zh-TW";

	// Check for exact match first
	const exactMatch = SUPPORTED_LANGUAGES.find(
		(lang) => lang.code.toLowerCase() === lower,
	);
	if (exactMatch) return exactMatch.code;

	// Extract primary language (e.g., "en" from "en-US")
	const primaryLanguage = lower.split("-")[0];
	const primaryMatch = SUPPORTED_LANGUAGES.find(
		(lang) => lang.code === primaryLanguage,
	);
	if (primaryMatch) return primaryLanguage;

	// Match by primary part (e.g., "zh" matches "zh-CN")
	const prefixMatch = SUPPORTED_LANGUAGES.find(
		(lang) => lang.code.split("-")[0] === primaryLanguage,
	);
	if (prefixMatch) return prefixMatch.code;

	// Fallback to English
	return "en";
}

/**
 * Get the best matching target language based on browser language
 */
export function getTargetLanguage(): string {
	const browserLanguage = getBrowserLanguage();
	return normalizeLanguageCode(browserLanguage);
}

/**
 * Check if a language code is supported
 */
export function isLanguageSupported(language: string): boolean {
	const normalized = language.replace("_", "-").toLowerCase();
	const primary = normalized.split("-")[0];
	return SUPPORTED_LANGUAGES.some(
		(lang) =>
			lang.code.toLowerCase() === normalized ||
			lang.code.toLowerCase().split("-")[0] === primary,
	);
}

/**
 * Get all supported language codes
 */
export function getSupportedLanguageCodes(): string[] {
	return SUPPORTED_LANGUAGES.map((lang) => lang.code);
}

/**
 * Get language name by code
 */
export function getLanguageName(code: string): string | null {
	const language = SUPPORTED_LANGUAGES.find((lang) => lang.code === code);
	return language?.name || null;
}

/**
 * Check if two language codes refer to the same language.
 * Resolves "auto" to the browser's UI language before comparing.
 * Handles regional variants (e.g. "en-US" matches "en").
 */
export function areLanguagesSame(
	langA: string | undefined,
	langB: string | undefined,
): boolean {
	if (!langA || !langB) return false;

	const resolve = (lang: string) =>
		lang === "auto" ? getBrowserLanguage() : lang;

	const resolvedA = resolve(langA);
	const resolvedB = resolve(langB);

	if (!isLanguageSupported(resolvedA) || !isLanguageSupported(resolvedB)) {
		return false;
	}

	// tinyld reports both Simplified and Traditional Chinese as bare "zh".
	// Keep that code variant-unknown so local detection cannot suppress an
	// actual Simplified/Traditional conversion.
	const normalizedA = resolvedA.toLowerCase();
	const normalizedB = resolvedB.toLowerCase();
	if (normalizedA === "zh" || normalizedB === "zh") {
		return normalizedA === normalizedB;
	}

	return normalizeLanguageCode(resolvedA) === normalizeLanguageCode(resolvedB);
}
