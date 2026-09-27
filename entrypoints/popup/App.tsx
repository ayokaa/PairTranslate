import { trackDeep } from "@solid-primitives/deep";
import { HashRouter, Route, useLocation, useNavigate } from "@solidjs/router";
import {
	Earth,
	ExternalLink,
	FileText,
	LayoutPanelLeft,
	Power,
	PowerOff,
	Settings2,
	ShieldCheck,
	ShieldOff,
	WandSparkles,
} from "lucide-solid";
import type { JSX } from "solid-js";
import {
	createEffect,
	createMemo,
	createResource,
	createSignal,
	Match,
	on,
	Switch,
} from "solid-js";
import { browser } from "#imports";
import { getThemeClass } from "@/utils/theme";
import { Button } from "~/components/Button";
import { Loading } from "~/components/Loading";
import { SettingsRecoveryBanner } from "~/components/SettingsRecoveryBanner";
import { SettingsProvider, useSettings } from "~/hooks/settings";
import { createTheme } from "~/hooks/theme";
import { cn } from "~/utils/cn";
import { WEB_ADAPTATION_MESSAGE } from "~/utils/constants";
import { t } from "~/utils/i18n";
import { createLogger } from "~/utils/rpc/logger";
import { openTranslatorPopup } from "~/utils/translator-window";
import { getCurrentDomain } from "./get-current";
import Overall from "./pages/Overall";
import Website from "./pages/Website";

const logger = createLogger(import.meta.env.DEV ? "debug" : "error", "Popup");

const Content = (props: { children?: JSX.Element }) => {
	const { settings, setSettings } = useSettings();
	const enabled = createMemo(() => settings.basic.enabled);

	const navigate = useNavigate();
	const location = useLocation();

	const [domain] = createResource(getCurrentDomain);
	const [isSummaryExcluded, setIsSummaryExcluded] = createSignal(false);
	const [adaptationRunning, setAdaptationRunning] = createSignal(false);
	const [adaptationResult, setAdaptationResult] = createSignal("");
	const adaptationResultText = () => {
		switch (adaptationResult()) {
			case "added":
				return t("popup.webAdaptation.added");
			case "updated":
				return t("popup.webAdaptation.updated");
			case "unchanged":
				return t("popup.webAdaptation.unchanged");
			case "noModel":
				return t("popup.webAdaptation.noModel");
			case "unavailable":
				return t("popup.webAdaptation.unavailable");
			case "failed":
				return t("popup.webAdaptation.failed");
			default:
				return "";
		}
	};
	const runAdaptation = async () => {
		setAdaptationRunning(true);
		setAdaptationResult("");
		try {
			const tabs = await browser.tabs.query({
				active: true,
				currentWindow: true,
			});
			const tabId = tabs[0]?.id;
			if (tabId === undefined) {
				setAdaptationResult("unavailable");
				return;
			}
			const result = await browser.tabs.sendMessage(
				tabId,
				{ type: WEB_ADAPTATION_MESSAGE },
				{ frameId: 0 },
			);
			setAdaptationResult(typeof result === "string" ? result : "failed");
		} catch {
			setAdaptationResult("unavailable");
		} finally {
			setAdaptationRunning(false);
		}
	};

	createEffect(
		on(
			[domain, () => trackDeep(settings.websiteRules)],
			async ([d]) => {
				if (!d) {
					setIsSummaryExcluded(false);
					return;
				}
				const matchedIdx = await window.rpc.matchWebsiteRule(d);
				// Guard against stale async result if domain changed while RPC was in flight
				if (domain() !== d) return;
				setIsSummaryExcluded(
					matchedIdx !== null &&
						settings.websiteRules[matchedIdx]?.enableSummary === false,
				);
			},
			{ defer: true },
		),
	);

	const toggleSummaryExclusion = async () => {
		const d = domain();
		if (!d) return;
		const idx = await window.rpc.matchWebsiteRule(d);
		if (idx !== null) {
			const currentlyExcluded =
				settings.websiteRules[idx]?.enableSummary === false;
			setSettings(
				"websiteRules",
				idx,
				"enableSummary",
				currentlyExcluded ? undefined : false,
			);
		} else {
			setSettings("websiteRules", settings.websiteRules.length, {
				urlPatterns: [d],
				enableSummary: false,
			});
		}
	};

	getCurrentDomain()
		.then((hostname) => window.rpc.matchWebsiteRule(hostname))
		.then((idx) => navigate(idx === null ? "overall" : "website"))
		.catch((e) => {
			logger.error("Failed to determine website rule route:", e);
			navigate("overall");
		});

	const theme = createTheme();
	createEffect(() => {
		document.documentElement.setAttribute(
			"data-theme",
			getThemeClass(theme()) || "",
		);
	});

	return (
		<div class="flex h-full min-h-0 w-full flex-1 flex-col gap-3 overflow-x-clip p-3">
			<div class="min-h-0 flex-1 overflow-y-auto overflow-x-clip">
				<SettingsRecoveryBanner />
				{props.children}
			</div>

			<footer class="shrink-0 overflow-x-clip border-t border-base-200 pt-3">
				<Button
					class="mb-2 w-full"
					variant="ghost"
					outline
					loading={adaptationRunning()}
					onClick={runAdaptation}
				>
					<WandSparkles size={16} />
					{adaptationRunning()
						? t("popup.webAdaptation.running")
						: t("popup.webAdaptation.run")}
				</Button>
				{adaptationResult() && (
					<p class="mb-2 text-xs text-base-content/70" role="status">
						{adaptationResultText()}
					</p>
				)}
				<button
					type="button"
					class={cn(
						"btn w-full justify-start gap-3 rounded-box",
						enabled() ? "btn-primary" : "btn-outline border-base-300",
					)}
					aria-pressed={enabled()}
					on:click={() => setSettings("basic", "enabled", !enabled())}
				>
					{enabled() ? <Power size={16} /> : <PowerOff size={16} />}
					<span class="font-medium">
						{enabled() ? t("popup.enable.on") : t("popup.enable.off")}
					</span>
				</button>

				<div class="mt-2 flex items-center gap-1">
					<Button
						class="btn-ghost tooltip aspect-square flex-1 border border-base-300 bg-base-200 text-base-content"
						size="sm"
						on:click={openTranslatorPopup}
						data-tip={t("popup.navigation.openTranslatorWindow")}
						aria-label={t("popup.navigation.openTranslatorWindow")}
					>
						<LayoutPanelLeft size={16} />
					</Button>
					<Button
						class="btn-ghost tooltip aspect-square flex-1 border border-base-300 bg-base-200 text-base-content"
						size="sm"
						disabled={!settings.summary.summaryModel}
						on:click={async () => {
							logger.info("Summary button clicked");
							try {
								const tabs = await browser.tabs.query({
									active: true,
									currentWindow: true,
								});
								const tabId = tabs[0]?.id;
								logger.debug("Sending message to tab:", tabId);
								if (tabId) {
									await browser.tabs.sendMessage(tabId, {
										type: "generate-summary",
									});
									logger.info("Message sent successfully");
								}
							} catch (e) {
								logger.error("Failed to send message:", e);
							}
						}}
						data-tip={t("summary.generate")}
						aria-label={t("summary.generate")}
					>
						<FileText size={16} />
					</Button>
					<Button
						class={cn(
							"tooltip aspect-square flex-1 border",
							isSummaryExcluded()
								? "btn-error border-error"
								: "btn-ghost border-base-300 bg-base-200 text-base-content",
						)}
						size="sm"
						on:click={toggleSummaryExclusion}
						data-tip={
							isSummaryExcluded()
								? t("summary.removeFromExclusion")
								: t("summary.addToExclusion")
						}
						aria-label={
							isSummaryExcluded()
								? t("summary.removeFromExclusion")
								: t("summary.addToExclusion")
						}
					>
						{isSummaryExcluded() ? (
							<ShieldOff size={16} />
						) : (
							<ShieldCheck size={16} />
						)}
					</Button>

					<div class="divider divider-horizontal mx-0 h-6" />

					<Switch>
						<Match when={location.pathname.includes("overall")}>
							<Button
								class="btn-ghost tooltip aspect-square flex-1 border border-base-300 bg-base-200 text-base-content"
								size="sm"
								on:click={() => navigate("website")}
								data-tip={t("nav.websiteRules")}
								aria-label={t("nav.websiteRules")}
							>
								<Earth size={16} />
							</Button>
						</Match>
						<Match when={location.pathname.includes("website")}>
							<Button
								class="btn-ghost tooltip aspect-square flex-1 border border-base-300 bg-base-200 text-base-content"
								size="sm"
								on:click={() => navigate("overall")}
								data-tip={t("nav.basic")}
								aria-label={t("nav.basic")}
							>
								<Settings2 size={16} />
							</Button>
						</Match>
					</Switch>

					<Button
						class="btn-ghost tooltip aspect-square flex-1 border border-base-300 bg-base-200 text-base-content"
						size="sm"
						on:click={() => browser.runtime.openOptionsPage()}
						data-tip={t("popup.navigation.openOptions")}
						aria-label={t("popup.navigation.openOptions")}
					>
						<ExternalLink size={16} />
					</Button>
				</div>
			</footer>
		</div>
	);
};

const FullScreenLoading = () => (
	<div class="w-full h-full flex items-center justify-center">
		<Loading size="xl" />
	</div>
);

export default () => {
	return (
		<SettingsProvider>
			<HashRouter root={Content}>
				<Route path="" component={FullScreenLoading} />
				<Route path="overall" component={Overall} />
				<Route path="website" component={Website} />
			</HashRouter>
		</SettingsProvider>
	);
};
