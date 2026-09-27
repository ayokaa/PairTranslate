import { browser } from "#imports";
import { STORAGE_KEYS } from "~/utils/constants";
import type { WebAdaptationService } from "~/utils/rpc";
import { getSettings, saveSettings } from "~/utils/settings/helper";
import {
	AdaptationProposalSchema,
	upsertAdaptationRule,
} from "~/utils/web-adaptation/model";

const CHECK_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CHECKS = 150;

export function createWebAdaptationService(): WebAdaptationService {
	let pending: Promise<unknown> = Promise.resolve();
	const pendingChecks = new Set<string>();
	const serialize = <T>(task: () => Promise<T>): Promise<T> => {
		const result = pending.then(task, task);
		pending = result.catch(() => {});
		return result;
	};

	return {
		reserveWebAdaptationCheck(key: string) {
			return serialize(async () => {
				if (!/^[a-f0-9]{8,32}$/i.test(key)) return false;
				if (pendingChecks.has(key)) return false;
				const stored = await browser.storage.local.get(
					STORAGE_KEYS.webAdaptationChecks,
				);
				const checks = (stored[STORAGE_KEYS.webAdaptationChecks] ??
					{}) as Record<string, number>;
				const now = Date.now();
				if (now - (checks[key] ?? 0) < CHECK_COOLDOWN_MS) return false;
				pendingChecks.add(key);
				return true;
			});
		},
		completeWebAdaptationCheck(key: string) {
			return serialize(async () => {
				if (!/^[a-f0-9]{8,32}$/i.test(key) || !pendingChecks.has(key)) return;
				try {
					const stored = await browser.storage.local.get(
						STORAGE_KEYS.webAdaptationChecks,
					);
					const checks = (stored[STORAGE_KEYS.webAdaptationChecks] ??
						{}) as Record<string, number>;
					checks[key] = Date.now();
					const recent = Object.fromEntries(
						Object.entries(checks)
							.filter(([, time]) => Number.isFinite(time))
							.sort((a, b) => b[1] - a[1])
							.slice(0, MAX_CHECKS),
					);
					await browser.storage.local.set({
						[STORAGE_KEYS.webAdaptationChecks]: recent,
					});
				} finally {
					pendingChecks.delete(key);
				}
			});
		},
		releaseWebAdaptationCheck(key: string) {
			return serialize(async () => {
				pendingChecks.delete(key);
			});
		},
		commitWebAdaptation(input) {
			return serialize(async () => {
				const proposal = AdaptationProposalSchema.parse(input);
				const settings = await getSettings();
				const result = upsertAdaptationRule(
					settings.webAdaptation.rules,
					proposal,
					Date.now(),
				);
				if (result.result !== "unchanged") {
					await saveSettings({
						...settings,
						webAdaptation: {
							...settings.webAdaptation,
							rules: result.rules,
						},
					});
				}
				return result.result;
			});
		},
	};
}
