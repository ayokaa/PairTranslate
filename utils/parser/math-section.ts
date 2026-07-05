import { getMarkdownFromSection } from "~/utils/markdown";
import type { DOMSection } from "./types";

/**
 * Checks whether a section contains only a display math formula.
 * Such sections should not be sent for translation because the original
 * rendered formula is already readable on the page.
 */
export const isDisplayOnlySection = (section: DOMSection): boolean => {
	const markdown = getMarkdownFromSection(section)
		.replace(/\u200B/g, "")
		.trim();

	return /^\$\$[\s\S]*\$\$$/.test(markdown);
};
