import { type Component, For, splitProps } from "solid-js";
import { Button } from "~/components/Button";
import { cn } from "~/utils/cn";

export interface ButtonOption {
	value: string;
	label: string;
	disabled?: boolean;
}

export interface ButtonGroupProps {
	options: ButtonOption[];
	value?: string;
	onChange?: (value: string) => void;
	size?: "xs" | "sm" | "md" | "lg";
	variant?: "primary" | "ghost" | "secondary";
	/** Distributes the buttons evenly across the full group width. */
	stretch?: boolean;
	class?: string;
	title?: string;
}

export const ButtonGroup: Component<ButtonGroupProps> = (props) => {
	const [local, divProps] = splitProps(props, [
		"options",
		"value",
		"onChange",
		"size",
		"variant",
		"stretch",
		"class",
		"title",
	]);

	const handleClick = (optionValue: string) => {
		local.onChange?.(optionValue);
	};

	return (
		<div
			class={cn("join", local.stretch && "flex w-full", local.class)}
			{...divProps}
			title={local.title}
		>
			<For each={local.options}>
				{(option) => (
					<Button
						size={local.size || "sm"}
						variant={
							local.value === option.value
								? local.variant || "primary"
								: "ghost"
						}
						class={cn(
							"join-item",
							local.value === option.value && "btn-active",
							local.stretch && "grow basis-0",
						)}
						onClick={() => handleClick(option.value)}
						disabled={option.disabled}
						title={option.label}
					>
						{option.label}
					</Button>
				)}
			</For>
		</div>
	);
};
