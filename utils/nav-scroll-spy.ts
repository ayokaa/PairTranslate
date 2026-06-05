/**
 * Pick the active nav section from the currently-intersecting set,
 * preferring the topmost section (first in DOM order).
 *
 * Returns null when nothing is currently intersecting (e.g. between
 * two long sections during a scroll).
 */
export function pickActiveNavSection(
	intersectingIds: Iterable<string>,
	domOrder: Iterable<string>,
): string | null {
	const set = new Set(intersectingIds);
	for (const id of domOrder) {
		if (set.has(id)) return id;
	}
	return null;
}
