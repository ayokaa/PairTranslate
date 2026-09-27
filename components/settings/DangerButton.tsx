import { type Component, createSignal, splitProps } from "solid-js";
import { Button, type ButtonProps } from "~/components/Button";
import { cn } from "~/utils/cn";

export interface DangerButtonProps extends ButtonProps {
	/**
	 * Filled red button for a standalone destructive action. The default tinted
	 * ghost suits icon rows where the danger cue should stay quiet.
	 */
	solid?: boolean;
	/** Ask for confirmation before running the action. */
	confirmMessage?: string;
}

/**
 * Single entry point for destructive actions, so delete, reset and clear always
 * look alike and always confirm.
 */
export const DangerButton: Component<DangerButtonProps> = (props) => {
	const [local, buttonProps] = splitProps(props, [
		"solid",
		"confirmMessage",
		"class",
		"children",
	]);

	const [pending, setPending] = createSignal(false);

	const handleClick = async (
		event: MouseEvent & { currentTarget: HTMLButtonElement; target: Element },
	) => {
		if (pending()) return;
		if (local.confirmMessage && !window.confirm(local.confirmMessage)) {
			return;
		}
		setPending(true);
		try {
			await (
				buttonProps.onClick as ((e: typeof event) => unknown) | undefined
			)?.(event);
		} finally {
			setPending(false);
		}
	};

	return (
		<Button
			{...buttonProps}
			variant={local.solid ? "error" : "ghost"}
			loading={buttonProps.loading || pending()}
			class={cn(!local.solid && "text-error", local.class)}
			onClick={handleClick}
		>
			{local.children}
		</Button>
	);
};
