import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  // brand-600/700 only — lighter oranges fail AA behind white text.
  primary: "bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-600",
  secondary:
    "bg-surface text-ink-800 border border-ink-300 hover:bg-ink-50 focus-visible:outline-brand-600",
  danger:
    "bg-danger-600 text-white hover:bg-danger-700 focus-visible:outline-danger-600",
  ghost: "text-ink-700 hover:bg-ink-100 focus-visible:outline-brand-600",
};

const SIZES: Record<Size, string> = {
  // min-h-11 keeps every control a comfortable phone tap target.
  sm: "min-h-9 px-3 text-sm gap-1.5",
  md: "min-h-11 px-4 text-sm gap-2",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md") {
  return [
    "inline-flex items-center justify-center rounded-lg font-semibold",
    "transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
    "disabled:cursor-not-allowed disabled:opacity-60",
    VARIANTS[variant],
    SIZES[size],
  ].join(" ");
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return (
    <button
      {...props}
      className={`${buttonClasses(variant, size)} ${className}`}
    />
  );
}
