const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Human readable byte size, e.g. `0 B`, `512 B`, `1.4 KB`, `12.7 MB`.
 *
 * Uses binary (1024) steps, which is how storage is actually accounted for.
 * Whole bytes never get a fractional part; larger units keep one decimal so
 * the value stays stable in narrow layouts.
 */
export const formatBytes = (bytes: number): string => {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

	const exponent = Math.min(
		Math.floor(Math.log(bytes) / Math.log(1024)),
		BYTE_UNITS.length - 1,
	);
	const value = bytes / 1024 ** exponent;

	return exponent === 0
		? `${value} ${BYTE_UNITS[exponent]}`
		: `${value.toFixed(1)} ${BYTE_UNITS[exponent]}`;
};

/**
 * Human readable latency, e.g. `0 ms`, `820 ms`, `1.24 s`, `12.5 s`.
 *
 * Sub-second values keep whole milliseconds because that is the resolution
 * users compare models at; longer waits switch to seconds so the digit count
 * stays short.
 */
export const formatLatency = (ms: number): string => {
	if (!Number.isFinite(ms) || ms <= 0) return "0 ms";
	return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
};

/** One decimal place for throughput figures such as tokens per second. */
export const formatRate = (value: number): string =>
	Number.isFinite(value) && value > 0 ? value.toFixed(1) : "0.0";

/** Percentage rounded to a whole number, clamped to 0-100. */
export const formatPercent = (value: number, total: number): string => {
	if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
		return "0%";
	}
	const percent = Math.min(100, Math.max(0, (value / total) * 100));
	return `${Math.round(percent)}%`;
};
