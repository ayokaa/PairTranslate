import { domListener } from "../base";
import type { Options, WebsiteParser } from "../types";

export const FEEDER_READER_EXCLUDED_SELECTORS = [
	// Reader navigation and feed-level controls
	".sidebar-navigation--inner",
	".bar--fixed.top",
	".post-feed-header",
	".tpl-sort-toolbar--large",
	".tpl-sort-toolbar--small",
	".current-post-header",
	// Post metadata and actions
	".reader--post-list-item--meta",
	".reader--post-list-item--quick-action-bar",
	".item-meta",
	".item-date",
	".expanded-bottom-bar",
	// Reader status, metadata tabs, and non-content blocks
	".reader-view-frame .tabs",
	".reader-view-frame .tab-content.meta",
	".translating-banner",
	".translated-content",
	".iframe-warning",
	".ad-feed-container",
];

export default (): WebsiteParser => ({
	urlPatterns: ["feeder.co"],
	domListener: (options) => {
		const newOptions: Options = {
			...options,
			excludedSelectors: [
				...(options?.excludedSelectors || []),
				...FEEDER_READER_EXCLUDED_SELECTORS,
			],
		};
		return domListener(newOptions);
	},
});
