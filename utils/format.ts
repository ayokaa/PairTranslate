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

/** Percentage rounded to a whole number, clamped to 0-100. */
export const formatPercent = (value: number, total: number): string => {
	if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
		return "0%";
	}
	const percent = Math.min(100, Math.max(0, (value / total) * 100));
	return `${Math.round(percent)}%`;
};
