/** A read-only island inside a real editor still belongs to that editor. */
export const EDITABLE_SELECTOR =
	'[contenteditable]:not([contenteditable="false" i])';

/**
 * aria-hidden describes the accessibility tree, not visual presentation.
 * Keep explicit hidden/editor boundaries separate from rendered visibility.
 */
export function isProtectedPageContent(element: Element): boolean {
	return element.closest(`[hidden], ${EDITABLE_SELECTOR}`) !== null;
}

/**
 * Test presentation without requiring viewport intersection or a layout box:
 * display:contents wrappers and below-the-fold paragraphs remain eligible.
 * A collapsed legacy clip rectangle covers screen-reader-only duplicate notes.
 */
export function isVisiblePageContent(element: Element): boolean {
	if (element.closest("[hidden]")) return false;
	const view = element.ownerDocument.defaultView;
	// DOM-only tooling has no CSS engine. Attribute safeguards still apply.
	if (!view?.getComputedStyle) return true;
	const ownStyle = view.getComputedStyle(element);
	if (ownStyle.visibility === "hidden" || ownStyle.visibility === "collapse")
		return false;
	for (let current: Element | null = element; current; ) {
		const style = view.getComputedStyle(current);
		if (
			style.display === "none" ||
			style.contentVisibility === "hidden" ||
			style.opacity === "0"
		)
			return false;
		if (style.position === "absolute" || style.position === "fixed") {
			const clip = style.clip.match(
				/^rect\(\s*(-?[\d.]+)px[,\s]+(-?[\d.]+)px[,\s]+(-?[\d.]+)px[,\s]+(-?[\d.]+)px\s*\)$/,
			);
			if (clip && (+clip[3] <= +clip[1] || +clip[2] <= +clip[4])) return false;
		}
		const parent: Element | null = current.parentElement;
		current = parent ?? (current.getRootNode() as ShadowRoot).host ?? null;
	}
	return true;
}
