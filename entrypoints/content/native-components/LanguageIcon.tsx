import type { JSX } from "solid-js";

/**
 * The lucide "languages" glyph as static markup.
 *
 * Every translated paragraph shows this icon, so a long page holds thousands
 * of them. The lucide component builds each one from a prop split, a list and
 * a dynamic element with spread attributes per path, which was about a third
 * of the memory retained per translated paragraph. Static JSX compiles to one
 * shared template that is cloned, with nothing reactive kept per instance.
 */
export const ICON_STYLE: JSX.CSSProperties = {
	"vertical-align": "middle",
	margin: "0 4px",
	background: "rgba(0, 0, 0, 0.1)",
	"border-radius": "4px",
	padding: "2px",
};

export const NativeLanguageIcon = () => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width="12px"
		height="12px"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		class="lucide lucide-icon lucide-languages"
		aria-hidden="true"
		// A constant, not a prop: a prop would keep one effect alive per icon.
		style={ICON_STYLE}
	>
		<path d="m5 8 6 6" />
		<path d="m4 14 6-6 2-3" />
		<path d="M2 5h12" />
		<path d="M7 2h1" />
		<path d="m22 22-5-10-5 10" />
		<path d="M14 18h6" />
	</svg>
);
