import { createSignal, onMount } from "solid-js";
import type { CacheStats } from "~/utils/rpc";
import { createLogger } from "~/utils/rpc/logger";

const logger = createLogger(
	import.meta.env.DEV ? "debug" : "error",
	"CacheStats",
);

// The statistics page and the advanced page both mount at once on the settings
// screen, and each read is a full cursor walk over the cache. Share one
// in-flight request so opening settings never triggers two walks.
let inflight: Promise<CacheStats | null> | null = null;

// Module level so clearing the cache from the advanced page immediately
// updates the statistics page too.
const [sharedStats, setSharedStats] = createSignal<CacheStats | null>(null);
const [sharedLoading, setSharedLoading] = createSignal(true);

const load = (): Promise<CacheStats | null> => {
	if (inflight) return inflight;

	// Wrapped in an async IIFE so a synchronous throw from `window.rpc` (for
	// example when the background worker has not finished registering the
	// method yet) is captured too — a plain `.catch()` cannot see a throw that
	// happens while the promise is being constructed.
	inflight = (async () => {
		try {
			return await window.rpc.cacheStats();
		} catch (error) {
			logger.error("Failed to read cache statistics", error);
			return null;
		}
	})().finally(() => {
		inflight = null;
	});

	return inflight;
};

export interface CacheStatsState {
	/** Latest snapshot, or null while loading or when the read failed. */
	stats: () => CacheStats | null;
	loading: () => boolean;
	/** Re-read the cache, e.g. right after clearing it. */
	refresh: () => Promise<void>;
}

export const useCacheStats = (): CacheStatsState => {
	onMount(() => {
		if (sharedLoading()) {
			void load().then((result) => {
				setSharedStats(result);
				setSharedLoading(false);
			});
		}
	});

	return {
		stats: sharedStats,
		loading: sharedLoading,
		refresh: async () => {
			setSharedLoading(true);
			setSharedStats(await load());
			setSharedLoading(false);
		},
	};
};
