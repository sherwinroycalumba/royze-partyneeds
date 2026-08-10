"use client";

import { useMemo, useState } from "react";

import { inputClasses } from "./field";

/**
 * Inline search for a list screen.
 *
 * Filters as you type against the rows already on the page — no round
 * trip, so it stays instant on the patchy mobile data staff work on.
 * The page still decides which slice to load; this narrows what is
 * visible within it.
 */
export function ListSearch({
  id,
  value,
  onChange,
  placeholder,
  label,
  resultCount,
  totalCount,
  noun,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Screen-reader label; the box itself shows only the placeholder. */
  label: string;
  resultCount: number;
  totalCount: number;
  /** Plural noun for the result count, e.g. "suppliers". */
  noun: string;
}) {
  const query = value.trim();

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative">
        <span
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
          aria-hidden="true"
        >
          <svg
            className="size-5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.7}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
        </span>

        <input
          id={id}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className={`${inputClasses} pl-10 ${query ? "pr-20" : ""}`}
        />

        {query && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-semibold text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800"
          >
            Clear
          </button>
        )}
      </div>

      {query && (
        <p className="text-xs text-ink-500" aria-live="polite">
          {resultCount} of {totalCount} {noun} match &ldquo;{query}&rdquo;.
        </p>
      )}
    </div>
  );
}

/**
 * Case- and punctuation-insensitive matching across a row's searchable
 * fields. Every whitespace-separated term must appear somewhere, so
 * "maria deca" finds Maria in Deca Homes regardless of field order.
 */
export function matchesQuery(
  query: string,
  fields: readonly (string | null | undefined)[],
): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = fields
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    // Fold punctuation so "0917-123 4567" matches a search for
    // "09171234567", and vice versa.
    .replace(/[^a-z0-9₱.]+/g, " ");

  const digits = haystack.replace(/\D/g, "");

  return terms.every((term) => {
    if (haystack.includes(term)) return true;
    // A purely numeric term also matches across formatting.
    const termDigits = term.replace(/\D/g, "");
    return termDigits.length > 0 && digits.includes(termDigits);
  });
}

/** Filters rows by a query and the fields each row exposes. */
export function useFiltered<T>(
  rows: readonly T[],
  query: string,
  fieldsOf: (row: T) => readonly (string | null | undefined)[],
): T[] {
  return useMemo(
    () => rows.filter((row) => matchesQuery(query, fieldsOf(row))),
    // `fieldsOf` is defined inline at every call site; depending on it
    // would recompute every render and defeat the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, query],
  );
}

/** Convenience state hook so each list page stays a few lines. */
export function useListSearch(): [string, (value: string) => void] {
  const [query, setQuery] = useState("");
  return [query, setQuery];
}
