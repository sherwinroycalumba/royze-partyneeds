import type { ComponentProps, ReactNode } from "react";

export const inputClasses = [
  "block w-full rounded-lg border border-ink-300 bg-surface px-3 py-2.5",
  "text-[16px] text-ink-900 placeholder:text-ink-400", // 16px avoids iOS zoom-on-focus
  "focus:border-brand-600 focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-brand-600/30",
  "disabled:bg-ink-100 disabled:text-ink-500",
].join(" ");

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-ink-700"
      >
        {label}
        {required && (
          <span className="ml-0.5 text-danger-600" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-ink-500">{hint}</p>}
      {error && (
        <p className="text-xs font-medium text-danger-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInput({ className = "", ...props }: ComponentProps<"input">) {
  return <input {...props} className={`${inputClasses} ${className}`} />;
}

export function TextArea({
  className = "",
  ...props
}: ComponentProps<"textarea">) {
  return <textarea {...props} className={`${inputClasses} ${className}`} />;
}

export function Select({
  className = "",
  ...props
}: ComponentProps<"select">) {
  return <select {...props} className={`${inputClasses} ${className}`} />;
}
