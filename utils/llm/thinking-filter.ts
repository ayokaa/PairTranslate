interface TagPattern {
	open: string;
	close: string;
}

const TAG_PATTERNS: TagPattern[] = [
	{ open: "<think>", close: "</think>" },
	{ open: "<thinking>", close: "</thinking>" },
	{ open: "<reasoning>", close: "</reasoning>" },
];

const OPEN_TAGS = TAG_PATTERNS.map((p) => p.open);
const CLOSE_TAGS = TAG_PATTERNS.map((p) => p.close);

function findEarliest(
	text: string,
	targets: string[],
): { index: number; length: number } | null {
	let earliestIndex = -1;
	let earliestLength = 0;
	for (const target of targets) {
		const idx = text.indexOf(target);
		if (idx !== -1 && (earliestIndex === -1 || idx < earliestIndex)) {
			earliestIndex = idx;
			earliestLength = target.length;
		}
	}
	if (earliestIndex === -1) return null;
	return { index: earliestIndex, length: earliestLength };
}

/**
 * Check if the given text is a prefix of any open tag.
 * e.g. "<" -> true, "<t" -> true, "<think" -> true, "<xyz" -> false
 */
function isPotentialTagPrefix(text: string): boolean {
	for (const tag of OPEN_TAGS) {
		if (tag.startsWith(text)) return true;
	}
	return false;
}

/**
 * Find the longest suffix of `text` that could be the start of an open tag.
 * Returns the length of that suffix. e.g. "abc<thi" -> 4 ("<thi" is a prefix of "<think>")
 */
function findTagPrefixSuffixLength(text: string): number {
	let maxLen = 0;
	for (let i = text.length - 1; i >= 0; i--) {
		const suffix = text.slice(i);
		if (suffix.startsWith("<") && isPotentialTagPrefix(suffix)) {
			maxLen = Math.max(maxLen, suffix.length);
		}
	}
	return maxLen;
}

/**
 * Creates a stateful filter that strips thinking/reasoning tags from LLM stream chunks.
 * Handles tags that may span across multiple chunks. All thinking content is discarded.
 */
export function createThinkingFilter() {
	let buffer = "";
	let inThinking = false;

	return {
		/**
		 * Process a chunk of text. Returns cleaned content with thinking tags and their contents removed.
		 */
		process(chunk: string): string | undefined {
			if (!chunk) return undefined;

			let text = buffer ? buffer + chunk : chunk;
			let content = "";
			buffer = "";

			while (text.length > 0) {
				if (inThinking) {
					const found = findEarliest(text, CLOSE_TAGS);

					if (found) {
						// Discard everything up to and including the closing tag
						text = text.slice(found.index + found.length);
						inThinking = false;
					} else {
						// Still inside thinking block, buffer for next chunk
						buffer = text;
						return content || undefined;
					}
				} else {
					const found = findEarliest(text, OPEN_TAGS);

					if (found) {
						content += text.slice(0, found.index);
						text = text.slice(found.index + found.length);
						inThinking = true;
					} else {
						// Check if the end of text could be a partial open tag
						const suffixLen = findTagPrefixSuffixLength(text);
						if (suffixLen > 0) {
							content += text.slice(0, text.length - suffixLen);
							buffer = text.slice(text.length - suffixLen);
						} else {
							content += text;
						}
						break;
					}
				}
			}

			return content || undefined;
		},

		/**
		 * Flush any remaining buffered thinking content when stream ends.
		 */
		flush(): string | undefined {
			if (inThinking) {
				inThinking = false;
				buffer = "";
				return undefined;
			}
			// If we have a buffered partial tag that never completed, return it as normal text
			if (buffer) {
				const leftover = buffer;
				buffer = "";
				return leftover || undefined;
			}
			return undefined;
		},
	};
}
