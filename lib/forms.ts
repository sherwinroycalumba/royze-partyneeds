import { parsePesoInput } from "@/lib/money";

/** Shared result shape for `useActionState` form actions. */
export type FormState = { error?: string; success?: string };

/**
 * FormData readers shared by every server action.
 *
 * Server Actions receive whatever the client posts, so each of these
 * coerces first and validates second — a missing field and a hostile
 * one both come back as a safe default rather than `undefined`.
 */

export function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** Trimmed text, or null when blank — matches nullable columns. */
export function nullableText(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return value === "" ? null : value;
}

/** An unchecked HTML checkbox posts nothing at all. */
export function checkbox(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === "on" || value === "true";
}

/**
 * A peso amount in integer centavos. Blank reads as 0 so optional
 * price fields do not force staff to type "0"; malformed input returns
 * null so the caller can reject it.
 */
export function pesoCentavos(formData: FormData, key: string): number | null {
  const raw = text(formData, key);
  if (raw === "") return 0;
  return parsePesoInput(raw);
}

/** A non-negative whole number; blank reads as 0, malformed as null. */
export function wholeNumber(formData: FormData, key: string): number | null {
  const raw = text(formData, key);
  if (raw === "") return 0;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) ? value : null;
}
