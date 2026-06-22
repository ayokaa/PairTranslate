import { getDomain } from "tldts";

export function getRootDomain(url: string): string | null {
	if (!url) return null;
	try {
		// Ensure the input is a valid URL before asking tldts.
		new URL(url);
	} catch {
		return null;
	}
	return getDomain(url);
}
