import { type Component, type JSX, splitProps } from "solid-js";
import { tv, type VariantProps } from "tailwind-variants";
import { cn } from "~/utils/cn";

/**
 * Heading for a block inside a `SettingsCard`.
 *
 * `md` is the block title and must stay visually below the card title, which is
 * itself `text-lg`. `sm` is the uppercase eyebrow used above a group of metrics
 * or fields.
 */
const headingVariants = tv({
	base: "h3",
	variants: {
		size: {
			sm: "text-[11px] font-semibold uppercase tracking-wide text-base-content/60",
			md: "text-base font-semibold",
		},
		/** Draws the top rule that separates stacked blocks. */
		divider: {
			true: "mb-3 border-t border-base-200 pt-4",
			false: "mb-3",
		},
	},
	defaultVariants: {
		size: "md",
		divider: false,
	},
});

export interface SectionHeadingProps
	extends JSX.HTMLAttributes<HTMLHeadingElement>,
		VariantProps<typeof headingVariants> {
	children: string;
}

export const SectionHeading: Component<SectionHeadingProps> = (props) => {
	const [local, headingProps] = splitProps(props, [
		"size",
		"divider",
		"class",
		"children",
	]);

	return (
		<h3
			{...headingProps}
			class={cn(
				headingVariants({ size: local.size, divider: local.divider }),
				local.class,
			)}
		>
			{local.children}
		</h3>
	);
};
