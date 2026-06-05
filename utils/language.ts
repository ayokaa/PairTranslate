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
	// Check for exact match first
	const exactMatch = SUPPORTED_LANGUAGES.find((lang) => lang.code === language);
	if (exactMatch) return language;

	// Extract primary language (e.g., "en" from "en-US")
	const primaryLanguage = language.split("-")[0];
	const primaryMatch = SUPPORTED_LANGUAGES.find(
		(lang) => lang.code === primaryLanguage,
	);
	if (primaryMatch) return primaryLanguage;

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
	return SUPPORTED_LANGUAGES.some(
		(lang) => lang.code === language || lang.code === language.split("-")[0],
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

	return normalizeLanguageCode(resolvedA) === normalizeLanguageCode(resolvedB);
}
