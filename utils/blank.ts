const MEANINGFUL_CHAR_REGEX = /\p{L}/u;

export const hasMeaningfulChars = (
	text: string | null | undefined,
): boolean => {
	return (
		text !== null &&
		text !== undefined &&
		text.trim().length > 1 &&
		MEANINGFUL_CHAR_REGEX.test(text)
	);
};
