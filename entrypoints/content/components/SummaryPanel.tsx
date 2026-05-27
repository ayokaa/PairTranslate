import { FileText } from "lucide-solid";
import { createEffect, Show } from "solid-js";
import { Alert } from "~/components/Alert";
import { Button } from "~/components/Button";
import { Loading } from "~/components/Loading";
import { MdStyled } from "~/components/MD/Md";
import { useSettings } from "~/hooks/settings";
import { createTranslation } from "~/hooks/translation";
import { PROMPT_ID } from "~/utils/constants";
import { t } from "~/utils/i18n";
import { createLogger } from "~/utils/rpc/logger";
import type { PageContext } from "~/utils/types";

const logger = createLogger(import.meta.env.DEV ? "debug" : "error", "Summary");

interface SummaryPanelProps {
	content: string;
	truncated: boolean;
	pageContext: PageContext;
}

export default (props: SummaryPanelProps) => {
	const { settings } = useSettings();

	const text = () => props.content;
	const ctx = () => ({
		page: props.pageContext,
	});

	const modelId = () => settings.translate.summaryModel;
	const srcLang = () => settings.translate.sourceLang;
	const dstLang = () => settings.translate.targetLang;

	const [result, retry] = createTranslation<string>(text, {
		promptId: PROMPT_ID.summary,
		modelId,
		srcLang,
		dstLang,
		ctx,
	});

	createEffect(() => {
		if (result.error) {
			logger.error("Translation error:", result.error);
		}
	});

	return (
		<div class="flex flex-col h-full">
			<div class="flex-1 overflow-y-auto overscroll-contain p-3 flex flex-col gap-3">
				<Show when={props.truncated}>
					<Alert
						variant="warning"
						size="sm"
						description={t("summary.contentTruncated")}
					/>
				</Show>

				<Show when={result.loading}>
					<div class="flex flex-col items-center gap-3 py-8">
						<Loading type="dots" size="lg" />
						<span class="text-sm text-base-content/70">
							{t("summary.generating")}
						</span>
					</div>
				</Show>

				<Show when={result.error}>
					<div class="flex flex-col gap-3">
						<Alert variant="error" size="sm" title={result.error?.message} />
						<Button size="sm" variant="primary" onClick={retry}>
							{t("common.retry")}
						</Button>
					</div>
				</Show>

				<Show when={result()}>
					<div class="prose prose-sm max-w-none">
						<MdStyled text={result() || ""} />
					</div>
				</Show>
			</div>

			<div class="shrink-0 px-3 py-2 border-t border-base-300 flex items-center gap-2 text-xs text-base-content/50">
				<FileText size={14} />
				<span>{t("summary.panelTitle")}</span>
				<div class="flex-1" />
				<Show when={!result.loading && !result.error}>
					<Button
						size="xs"
						variant="ghost"
						onClick={() => {
							retry();
						}}
					>
						{t("common.retry")}
					</Button>
				</Show>
			</div>
		</div>
	);
};
