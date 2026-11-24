import { getMarkdownFromSection } from "~/utils/markdown";
import type { DOMSection } from "./types";

/**
 * Checks whether a section contains only a display math formula.
 * Such sections should not be sent for translation because the original
 * rendered formula is already readable on the page.
 */
export const isDisplayOnlyMarkdown = (markdown: string): boolean =>
	/^\$\$[\s\S]*\$\$$/.test(markdown.replace(/\u200B/g, "").trim());

export const isDisplayOnlySection = (section: DOMSection): boolean =>
	isDisplayOnlyMarkdown(getMarkdownFromSection(section));
