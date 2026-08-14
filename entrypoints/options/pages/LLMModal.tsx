import {
	Box,
	ChevronDown,
	ChevronUp,
	Eye,
	EyeOff,
	Globe,
	KeyRound,
	Package,
	Plus,
	RefreshCcw,
	Scale,
	SquarePen,
	Thermometer,
	Trash2,
} from "lucide-solid";
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { v4 as uuidv4 } from "uuid";
import z from "zod";
import { Button } from "~/components/Button";
import { Modal } from "~/components/Modal";
import { cn } from "~/utils/cn";
import { t } from "~/utils/i18n";
import { createLLMClient } from "~/utils/llm";
import { THINKING_BUDGET_LEVELS } from "~/utils/llm/thinking";
import {
	type LLMModelSettings,
	LLMServiceSettings,
	type QueueControlSettings,
} from "~/utils/settings/def";
import { LLMServiceTemplates } from "~/utils/settings/default";
import { QueueOverrideFields } from "../components/QueueOverrideFields";

type LLMService = z.infer<typeof LLMServiceSettings>;

interface LLMModalProps {
	modelInfo?: LLMService;
	onSave: (config: LLMService) => void;
	onClose: () => void;
	open?: boolean;
	queueDefaults: QueueControlSettings;
}

const hasModelOverrides = (model: LLMModelSettings): boolean =>
	model.temperature !== undefined ||
	model.maxOutputTokens !== undefined ||
	model.thinkingBudget !== undefined ||
	model.extraBody !== undefined;

export default (props: LLMModalProps) => {
	const DEFAULT: LLMService = {
		type: "llm",
		name: "",
		baseUrl: "",
		apiSpec: "openai",
		apiKey: "",
		models: {},
	};
	const [formData, setFormData] = createSignal(props.modelInfo || DEFAULT);
	// Per-model extraBody is edited as JSON text, keyed by model UUID.
	const [extraBodyDrafts, setExtraBodyDrafts] = createSignal<
		Record<string, string>
	>({});
	const [expandedModels, setExpandedModels] = createSignal<
		Record<string, boolean>
	>({});

	const [validationErrors, setValidationErrors] =
		createSignal<z.ZodError | null>(null);
	const [selectedTemplate, setSelectedTemplate] = createSignal<string>("");
	const [availableModels, setAvailableModels] = createSignal<string[]>([]);
	const [isLoadingModels, setIsLoadingModels] = createSignal<boolean>(false);
	const [modelFetchError, setModelFetchError] = createSignal<string | null>(
		null,
	);
	const [apiKeyVisible, setApiKeyVisible] = createSignal(false);

	createEffect(
		on([() => props.modelInfo, () => props.open], ([info, open]) => {
			if (open) {
				setFormData(info || DEFAULT);
				const drafts: Record<string, string> = {};
				const expanded: Record<string, boolean> = {};
				for (const [id, model] of Object.entries(info?.models ?? {})) {
					if (model.extraBody) {
						drafts[id] = JSON.stringify(model.extraBody);
					}
					expanded[id] = hasModelOverrides(model);
				}
				setExtraBodyDrafts(drafts);
				setExpandedModels(expanded);
			}
		}),
	);

	const handleTemplateChange = (templateName: string) => {
		setSelectedTemplate(templateName);
		const template = LLMServiceTemplates.find((t) => t.name === templateName);
		if (template && template.type === "llm") {
			setFormData({
				...formData(),
				type: "llm",
				name: template.name,
				baseUrl: template.baseUrl,
				apiSpec: template.apiSpec,
			});
			setApiKeyVisible(false);
		}
	};

	const handleFetchModels = async () => {
		const config = formData();
		if (!config.baseUrl) {
			setModelFetchError(t("errors.llm.baseUrlRequired"));
			return;
		}

		setIsLoadingModels(true);
		setModelFetchError(null);

		try {
			const clientConfig = {
				apiKey: config.apiKey,
				baseUrl: config.baseUrl,
			};

			// Create client based on API spec with proper type narrowing
			const client =
				config.apiSpec === "openai"
					? createLLMClient("openai", clientConfig)
					: config.apiSpec === "anthropic"
						? createLLMClient("anthropic", clientConfig)
						: createLLMClient("google", clientConfig);

			const models = await client.listModels();

			const modelIds = Array.isArray(models) ? models.map((m) => m.id) : [];
			setAvailableModels(modelIds);
		} catch (error) {
			setModelFetchError(
				error instanceof Error
					? error.message
					: t("errors.llm.fetchModelsFailed"),
			);
		} finally {
			setIsLoadingModels(false);
		}
	};

	const modelEntries = () => Object.entries(formData().models ?? {});

	const handleAddModel = (name = "") => {
		const id = uuidv4();
		setFormData((prev) => ({
			...prev,
			models: { ...prev.models, [id]: { name } },
		}));
		setExpandedModels((prev) => ({ ...prev, [id]: true }));
	};

	const handleUpdateModel = (
		modelId: string,
		patch: Partial<LLMModelSettings>,
	) => {
		setFormData((prev) => {
			const current = prev.models[modelId];
			if (!current) return prev;
			return {
				...prev,
				models: { ...prev.models, [modelId]: { ...current, ...patch } },
			};
		});
	};

	const handleRemoveModel = (modelId: string) => {
		setFormData((prev) => {
			const models = { ...prev.models };
			delete models[modelId];
			return { ...prev, models };
		});
		setExtraBodyDrafts((prev) => {
			const next = { ...prev };
			delete next[modelId];
			return next;
		});
	};

	const handleSave = (e: Event) => {
		e.preventDefault();
		const models: LLMService["models"] = {};
		for (const [id, entry] of Object.entries(formData().models ?? {})) {
			const next = { ...entry };
			const draft = extraBodyDrafts()[id];
			if (draft !== undefined) {
				const trimmed = draft.trim();
				if (trimmed) {
					try {
						next.extraBody = JSON.parse(trimmed);
					} catch {
						setValidationErrors(
							new z.ZodError([
								{
									code: "custom",
									path: ["models", id, "extraBody"],
									message: "Invalid JSON format",
								},
							]),
						);
						return;
					}
				} else {
					delete next.extraBody;
				}
			}
			models[id] = next;
		}
		const currentData = { ...formData(), models };

		const result = LLMServiceSettings.safeParse(currentData);
		if (result.success) {
			props.onSave(result.data);
			props.onClose();
			setValidationErrors(null);
		} else {
			setValidationErrors(result.error);
		}
	};

	const getFieldError = (fieldPath: string[]) => {
		if (!validationErrors()) return null;
		return validationErrors()?.issues.find(
			(issue) =>
				issue.path.length === fieldPath.length &&
				issue.path.every((segment, index) => segment === fieldPath[index]),
		);
	};

	const renderError = (fieldPath: string[]) => {
		const error = getFieldError(fieldPath);
		return (
			error && (
				<div class="label py-1">
					<span class="label-text-alt text-xs text-error">{error.message}</span>
				</div>
			)
		);
	};

	return (
		<Modal
			open={props.open}
			onClose={props.onClose}
			title={
				props.modelInfo
					? t("settings.llmModal.editTitle")
					: t("settings.llmModal.addTitle")
			}
			backdrop
			actions={
				<>
					<Button variant="ghost" onClick={props.onClose}>
						{t("common.cancel")}
					</Button>
					<Button variant="primary" onClick={handleSave}>
						{t("common.save")}
					</Button>
				</>
			}
		>
			<div class="space-y-6">
				<div class="grid gap-4 md:grid-cols-2">
					<div class="form-control">
						<div class="label pb-1">
							<span class="label-text text-xs font-semibold uppercase text-base-content/60">
								{t("settings.llmModal.serviceTemplate")}
							</span>
						</div>
						<select
							class="select select-bordered w-full"
							value={selectedTemplate()}
							onChange={(e) => handleTemplateChange(e.target.value)}
						>
							<option value="">{t("settings.llmModal.customService")}</option>
							{LLMServiceTemplates.map((template) => (
								<option value={template.name}>{template.name}</option>
							))}
						</select>
					</div>

					<div class="form-control">
						<div class="label pb-1">
							<span class="label-text text-xs font-semibold uppercase text-base-content/60">
								{t("settings.llmModal.serviceName")}
							</span>
						</div>
						<label
							class={cn(
								"input input-bordered flex items-center gap-2",
								getFieldError(["name"]) && "input-error",
							)}
						>
							<SquarePen size={16} class="text-base-content/60" />
							<input
								type="text"
								class="grow bg-transparent"
								value={formData().name}
								onChange={(e) =>
									setFormData({ ...formData(), name: e.currentTarget.value })
								}
								placeholder={t("settings.llmModal.serviceNamePlaceholder")}
							/>
						</label>
						{renderError(["name"])}
					</div>
				</div>

				<div class="grid gap-4 md:grid-cols-2">
					<div class="form-control">
						<div class="label pb-1">
							<span class="label-text text-xs font-semibold uppercase text-base-content/60">
								{t("settings.llmModal.apiSpec")}
							</span>
						</div>
						<select
							class="select select-bordered w-full"
							value={formData().apiSpec}
							onChange={(e) =>
								setFormData({
									...formData(),
									apiSpec: e.currentTarget.value as
										| "openai"
										| "anthropic"
										| "google",
								})
							}
						>
							<option value="openai">
								{t("settings.llmModal.apiSpecs.openai")}
							</option>
							<option value="anthropic">
								{t("settings.llmModal.apiSpecs.anthropic")}
							</option>
							<option value="google">
								{t("settings.llmModal.apiSpecs.gemini")}
							</option>
						</select>
					</div>

					<div class="form-control">
						<div class="label pb-1">
							<span class="label-text text-xs font-semibold uppercase text-base-content/60">
								{t("settings.llmModal.baseUrl")}
							</span>
						</div>
						<label
							class={cn(
								"input input-bordered flex items-center gap-2",
								getFieldError(["baseUrl"]) && "input-error",
							)}
						>
							<Globe size={16} class="text-base-content/60" />
							<input
								type="url"
								class="grow bg-transparent"
								value={formData().baseUrl}
								onChange={(e) =>
									setFormData({ ...formData(), baseUrl: e.currentTarget.value })
								}
								placeholder={t("settings.llmModal.baseUrlPlaceholder")}
							/>
						</label>
						{renderError(["baseUrl"])}
					</div>
				</div>

				<div class="grid gap-4 md:grid-cols-2">
					<div class="form-control">
						<div class="label pb-1">
							<span class="label-text text-xs font-semibold uppercase text-base-content/60">
								{t("settings.llmModal.apiKey")}
							</span>
						</div>
						<label class="input input-bordered flex items-center gap-2">
							<KeyRound size={16} class="text-base-content/60" />
							<input
								type={apiKeyVisible() ? "text" : "password"}
								class="grow bg-transparent"
								value={formData().apiKey || ""}
								onChange={(e) =>
									setFormData({ ...formData(), apiKey: e.currentTarget.value })
								}
								placeholder={t("settings.llmModal.apiKeyPlaceholder")}
							/>
							<button
								type="button"
								class="btn btn-ghost btn-xs btn-circle"
								onClick={() => setApiKeyVisible((v) => !v)}
							>
								<Show
									when={apiKeyVisible()}
									fallback={<Eye size={14} class="text-base-content/60" />}
								>
									<EyeOff size={14} class="text-base-content/60" />
								</Show>
							</button>
						</label>
					</div>
				</div>

				<div class="form-control">
					<div class="flex items-center justify-between pb-2">
						<span class="label-text text-xs font-semibold uppercase text-base-content/60">
							{t("settings.llmModal.models")}
						</span>
						<Button
							type="button"
							variant="primary"
							size="sm"
							class="gap-2"
							onClick={handleFetchModels}
							loading={isLoadingModels()}
							disabled={isLoadingModels() || !formData().baseUrl}
						>
							<RefreshCcw size={14} />
							<span class="hidden sm:inline">{t("actions.fetchModels")}</span>
						</Button>
					</div>

					<Show when={availableModels().length > 0}>
						<select
							class="select select-bordered select-sm mb-1 w-full"
							value=""
							onChange={(e) => {
								const name = e.currentTarget.value;
								if (name) {
									handleAddModel(name);
								}
								e.currentTarget.value = "";
							}}
						>
							<option value="">{t("settings.llmModal.addFetchedModel")}</option>
							{availableModels()
								.filter(
									(fetched) =>
										!modelEntries().some(([, entry]) => entry.name === fetched),
								)
								.map((fetched) => (
									<option value={fetched}>{fetched}</option>
								))}
						</select>
						<div class="label py-1">
							<span class="label-text-alt text-xs">
								{t("common.modelsLoaded", [
									availableModels().length.toString(),
								])}
							</span>
						</div>
					</Show>
					<Show when={modelFetchError()}>
						{(message) => (
							<div class="label py-1">
								<span class="label-text-alt text-xs text-error">
									{message()}
								</span>
							</div>
						)}
					</Show>

					<div class="space-y-2">
						<For each={modelEntries()}>
							{([modelId, model]) => (
								<div class="rounded-lg border border-base-200 p-3">
									<div class="flex items-center gap-2">
										<label
											class={cn(
												"input input-bordered input-sm flex grow items-center gap-2",
												getFieldError(["models", modelId, "name"]) &&
													"input-error",
											)}
										>
											<Box size={14} class="text-base-content/60" />
											<input
												type="text"
												class="grow bg-transparent"
												value={model.name}
												onChange={(e) =>
													handleUpdateModel(modelId, {
														name: e.currentTarget.value,
													})
												}
												placeholder={t(
													"settings.llmModal.modelNamePlaceholder",
												)}
											/>
										</label>
										<button
											type="button"
											class="btn btn-ghost btn-xs btn-circle tooltip"
											data-tip={t("settings.llmModal.modelParams")}
											onClick={() =>
												setExpandedModels((prev) => ({
													...prev,
													[modelId]: !prev[modelId],
												}))
											}
										>
											<Show
												when={expandedModels()[modelId]}
												fallback={<ChevronDown size={14} />}
											>
												<ChevronUp size={14} />
											</Show>
										</button>
										<button
											type="button"
											class="btn btn-ghost btn-xs btn-circle text-error tooltip"
											data-tip={t("common.delete")}
											onClick={() => handleRemoveModel(modelId)}
										>
											<Trash2 size={14} />
										</button>
									</div>
									{renderError(["models", modelId, "name"])}
									<Show when={expandedModels()[modelId]}>
										<div class="mt-3 grid gap-3 md:grid-cols-2">
											<label class="input input-bordered input-sm flex items-center gap-2">
												<Thermometer size={14} class="text-base-content/60" />
												<input
													type="number"
													step="0.1"
													class="grow bg-transparent"
													value={model.temperature ?? ""}
													onChange={(e) =>
														handleUpdateModel(modelId, {
															temperature: e.currentTarget.value
																? Number(e.currentTarget.value)
																: undefined,
														})
													}
													placeholder={t("settings.llmModal.temperature")}
												/>
											</label>
											<label class="input input-bordered input-sm flex items-center gap-2">
												<Package size={14} class="text-base-content/60" />
												<input
													type="number"
													class="grow bg-transparent"
													value={model.maxOutputTokens ?? ""}
													onChange={(e) =>
														handleUpdateModel(modelId, {
															maxOutputTokens: e.currentTarget.value
																? Number(e.currentTarget.value)
																: undefined,
														})
													}
													placeholder={t("settings.llmModal.maxTokens")}
												/>
											</label>
											<label class="select select-bordered select-sm flex items-center gap-2">
												<Scale size={14} class="text-base-content/60" />
												<select
													class="grow"
													value={model.thinkingBudget ?? ""}
													onChange={(e) =>
														handleUpdateModel(modelId, {
															thinkingBudget:
																e.currentTarget.value === ""
																	? undefined
																	: (e.currentTarget
																			.value as (typeof THINKING_BUDGET_LEVELS)[number]),
														})
													}
												>
													<option value="">
														{t("settings.llmModal.thinkingBudgetDefault")}
													</option>
													{THINKING_BUDGET_LEVELS.map((level) => (
														<option value={level}>
															{t(
																`settings.llmModal.thinkingBudgetOptions.${level}`,
															)}
														</option>
													))}
												</select>
											</label>
											<label
												class={cn(
													"input input-bordered input-sm flex items-center gap-2",
													getFieldError(["models", modelId, "extraBody"]) &&
														"input-error",
												)}
											>
												<Box size={14} class="text-base-content/60" />
												<input
													type="text"
													class="grow bg-transparent"
													value={extraBodyDrafts()[modelId] ?? ""}
													onChange={(e) =>
														setExtraBodyDrafts((prev) => ({
															...prev,
															[modelId]: e.currentTarget.value,
														}))
													}
													placeholder='{"top_k": 3}'
												/>
											</label>
										</div>
										{renderError(["models", modelId, "extraBody"])}
									</Show>
								</div>
							)}
						</For>
					</div>

					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="mt-2 gap-2 self-start"
						onClick={() => handleAddModel()}
					>
						<Plus size={14} />
						{t("settings.llmModal.addModel")}
					</Button>
				</div>

				<QueueOverrideFields
					value={formData().queue}
					defaults={props.queueDefaults}
					onChange={(queue) =>
						setFormData((prev) => ({
							...prev,
							queue,
						}))
					}
				/>
			</div>
		</Modal>
	);
};
