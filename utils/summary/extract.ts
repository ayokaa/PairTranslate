import {
	DATA_CONTAINER,
	DATA_HIDE,
	DATA_TRANSLATED,
	EXCLUDED_SELECTORS,
	INTERACTIVE_SELECTORS,
} from "~/utils/constants";
import { createLogger } from "~/utils/rpc/logger";

const logger = createLogger(import.meta.env.DEV ? "debug" : "error", "Summary");

const MAX_CONTENT_LENGTH = 500_000;

// `data-pt-translated` marks a section this extension has already served a
// translation for. The attribute goes on the element that holds the page's own
// text — the translation itself is a sibling container inside it — so dropping
// the marked element wholesale would take the original down with the
// translation, and once the in-text translation has run that leaves nothing to
// read. Keep those hosts readable and drop only what is not the page's text.
const EXCLUDED_FOR_CONTENT = [
	...EXCLUDED_SELECTORS.filter(
		(selector) => selector !== `[${DATA_TRANSLATED}]`,
	),
	// The original of a section translated in replace mode is hidden this way.
	`[${DATA_HIDE}]`,
];

const getMainContentElement = (): HTMLElement | null => {
	const selectors = [
		"article",
		"main",
		'[role="main"]',
		".post-content",
		".entry-content",
		".article-content",
		".content",
		"#content",
	];

	for (const selector of selectors) {
		const el = document.querySelector(selector);
		if (el?.textContent && el.textContent.trim().length > 200) {
			return el as HTMLElement;
		}
	}

	return document.body;
};

/**
 * Whether the text a translation container sits next to is still there.
 *
 * A container is inserted into the element that holds the section it translates.
 * While that text is in the document (the default parallel mode) the container
 * would only repeat it; once it is gone (replace mode empties the nodes or hides
 * them) the container is the only copy left, and the page still has to read as
 * something.
 */
const hasOriginalText = (container: Element): boolean => {
	const host = container.parentElement;
	if (!host) return false;
	for (const node of Array.from(host.childNodes)) {
		if (node === container) continue;
		if (node.nodeType === Node.TEXT_NODE) {
			if ((node.textContent ?? "").trim()) return true;
			continue;
		}
		if (!(node instanceof Element)) continue;
		if (node.hasAttribute(DATA_HIDE)) continue;
		if ((node.textContent ?? "").trim()) return true;
	}
	return false;
};

const isVisible = (el: Element): boolean => {
	const style = window.getComputedStyle(el);
	return (
		style.display !== "none" &&
		style.visibility !== "hidden" &&
		style.opacity !== "0"
	);
};

const walkTextNodes = (
	root: HTMLElement,
	onText: (text: string, tagName: string) => void,
): void => {
	const excluded = new Set(
		Array.from(root.querySelectorAll(EXCLUDED_FOR_CONTENT.join(", "))),
	);
	const interactive = new Set(
		Array.from(root.querySelectorAll(INTERACTIVE_SELECTORS.join(", "))),
	);

	const walker = document.createTreeWalker(
		root,
		NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
		{
			acceptNode: (node) => {
				if (node.nodeType === Node.TEXT_NODE) {
					return NodeFilter.FILTER_ACCEPT;
				}
				if (node.nodeType === Node.ELEMENT_NODE) {
					const el = node as Element;
					if (el.hasAttribute(DATA_CONTAINER)) {
						return hasOriginalText(el)
							? NodeFilter.FILTER_REJECT
							: NodeFilter.FILTER_SKIP;
					}
					if (excluded.has(el) || interactive.has(el)) {
						return NodeFilter.FILTER_REJECT;
					}
					if (!isVisible(el)) {
						return NodeFilter.FILTER_REJECT;
					}
					const tagName = el.tagName.toLowerCase();
					if (
						tagName === "script" ||
						tagName === "style" ||
						tagName === "noscript"
					) {
						return NodeFilter.FILTER_REJECT;
					}
					return NodeFilter.FILTER_SKIP;
				}
				return NodeFilter.FILTER_REJECT;
			},
		},
	);

	let node: Node | null = walker.nextNode();
	while (node) {
		if (node.nodeType === Node.TEXT_NODE) {
			const parent = node.parentElement;
			const tagName = parent ? parent.tagName.toUpperCase() : "";
			onText(node.textContent || "", tagName);
		}
		node = walker.nextNode();
	}
};

export interface ExtractedContent {
	content: string;
	truncated: boolean;
}

export function extractPageContent(): ExtractedContent {
	const root = getMainContentElement();
	logger.debug("Extract root element:", root?.tagName || "null");
	if (!root) {
		logger.warn("No root element found");
		return { content: "", truncated: false };
	}

	const lines: string[] = [];
	let currentLine = "";
	const blockTags = new Set([
		"P",
		"DIV",
		"SECTION",
		"ARTICLE",
		"LI",
		"TD",
		"H1",
		"H2",
		"H3",
		"H4",
		"H5",
		"H6",
		"BLOCKQUOTE",
		"PRE",
	]);

	walkTextNodes(root, (text, tagName) => {
		const trimmed = text.trim();
		if (!trimmed) return;

		if (tagName.startsWith("H") && tagName.length === 2) {
			const level = tagName[1];
			if (currentLine) {
				lines.push(currentLine.trim());
				currentLine = "";
			}
			lines.push(`${"#".repeat(Number.parseInt(level, 10))} ${trimmed}`);
			return;
		}

		if (blockTags.has(tagName)) {
			if (currentLine) {
				lines.push(currentLine.trim());
				currentLine = "";
			}
			currentLine = trimmed;
		} else {
			currentLine += (currentLine ? " " : "") + trimmed;
		}
	});

	if (currentLine) {
		lines.push(currentLine.trim());
	}

	let content = lines.join("\n\n");
	let truncated = false;
	logger.info(`Extracted ${lines.length} lines, ${content.length} chars`);

	const originalLength = content.length;
	if (originalLength > MAX_CONTENT_LENGTH) {
		const truncatedContent = content.slice(0, MAX_CONTENT_LENGTH);
		const lastBreak = truncatedContent.lastIndexOf("\n\n");
		if (lastBreak > MAX_CONTENT_LENGTH * 0.8) {
			content = truncatedContent.slice(0, lastBreak);
		} else {
			content = truncatedContent;
		}
		truncated = true;
		logger.warn(
			`Content truncated from ${originalLength} to ${MAX_CONTENT_LENGTH} chars`,
		);
	}

	return { content, truncated };
}
