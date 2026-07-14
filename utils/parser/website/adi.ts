import { domListener } from "../base";
import type { Options, WebsiteParser } from "../types";

export default (): WebsiteParser => ({
	urlPatterns: ["adi.bio", "*.adi.bio"],
	domListener: (options) => {
		const newOptions: Options = {
			...options,
			promoteTextTags: [...(options?.promoteTextTags || []), "P"],
		};
		return domListener(newOptions);
	},
});
