import { detect } from "tinyld";

/**
 * Detect the source language of the given text using a fast, local
 * n-gram based detector (tinyld). Returns null when the text is empty
 * or too short for reliable detection — callers should treat null as
 * "fall back to the configured service's auto behavior".
 */
export async function detectSourceLanguage(
	text: string,
): Promise<string | null> {
	if (!text || text.trim().length === 0) return null;
	const result = detect(text);
	if (!result) return null;
	return result;
}
