export const FRAME_TRANSLATION_PORT_NAME =
	"pair-translate:frame-translation-state";

export type FrameTranslationStateMessage = {
	type: "frame-translation-state";
	enabled: boolean;
};

export const createFrameTranslationStateMessage = (
	enabled: boolean,
): FrameTranslationStateMessage => ({
	type: "frame-translation-state",
	enabled,
});

export const isFrameTranslationStateMessage = (
	value: unknown,
): value is FrameTranslationStateMessage => {
	if (!value || typeof value !== "object") return false;
	const message = value as Partial<FrameTranslationStateMessage>;
	return (
		message.type === "frame-translation-state" &&
		typeof message.enabled === "boolean"
	);
};
