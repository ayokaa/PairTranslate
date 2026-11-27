import z from "zod";
import { THINKING_BUDGET_LEVELS } from "../llm/thinking";

export const ModelSelectionSettings = z.object({
	modelId: z.uuid(),
	thinkingBudget: z.enum(THINKING_BUDGET_LEVELS).optional(),
});
export type ModelSelectionSettings = z.infer<typeof ModelSelectionSettings>;

export function withModelId(
	selection: ModelSelectionSettings | undefined,
	modelId: string | undefined,
): ModelSelectionSettings | undefined {
	return modelId ? { ...selection, modelId } : undefined;
}
