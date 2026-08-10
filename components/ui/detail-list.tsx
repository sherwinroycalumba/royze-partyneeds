import type { ReactNode } from "react";

/**
 * Label/value rows for a profile page.
 *
 * A row with no value renders nothing at all, so a sparse record shows
 * a short list rather than a column of blanks.
 */
export function DetailList({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-ink-200">{children}</dl>;
}

export function Detail({
  label,
  value,
  href,
}: {
  label: string;
  value: string | null;
  /** Renders the value as a link — `tel:`, `mailto:`, or a profile URL. */
  href?: string;
}) {
  if (!value) return null;

  return (
    <div className="px-4 py-3 sm:flex sm:gap-4 sm:px-6">
      <dt className="w-40 shrink-0 text-sm font-medium text-ink-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm break-words text-ink-900 sm:mt-0">
        {href ? (
          <a
            href={href}
            className="font-medium text-brand-700 underline underline-offset-2"
          >
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
