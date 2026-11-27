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
 * Creates a stateful filter that strips leading thinking/reasoning envelopes.
 * Tags after translated content are literal text and must be preserved.
 */
export function createThinkingFilter() {
	let buffer = "";
	let inThinking = false;
	let acceptsReasoning = true;

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
					if (!acceptsReasoning) {
						content += text;
						break;
					}
					const firstContent = text.search(/\S/);
					if (firstContent === -1) {
						content += text;
						break;
					}
					const found = findEarliest(text, OPEN_TAGS);
					if (found && !text.slice(0, found.index).trim()) {
						content += text.slice(0, found.index);
						text = text.slice(found.index + found.length);
						inThinking = true;
						continue;
					}
					const candidate = text.slice(firstContent);
					if (isPotentialTagPrefix(candidate)) {
						content += text.slice(0, firstContent);
						buffer = candidate;
					} else {
						acceptsReasoning = false;
						content += text;
					}
					break;
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
