import { type Component, type JSX, Show } from "solid-js";
import { cn } from "~/utils/cn";

export interface EmptyStateProps {
	title: string;
	description?: string;
	icon?: JSX.Element;
	action?: JSX.Element;
	class?: string;
}

/** Placeholder shown where a list would be, with nothing to list yet. */
export const EmptyState: Component<EmptyStateProps> = (props) => {
	return (
		<div
			class={cn(
				"flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-base-300 bg-base-100 p-8 text-center text-base-content/70",
				props.class,
			)}
		>
			<Show when={props.icon}>
				<div class="mb-3 text-base-content/50">{props.icon}</div>
			</Show>
			<p class="text-base font-medium">{props.title}</p>
			<Show when={props.description}>
				<p class="mt-2 text-sm">{props.description}</p>
			</Show>
			<Show when={props.action}>
				<div class="mt-4">{props.action}</div>
			</Show>
		</div>
	);
};
