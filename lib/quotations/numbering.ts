/**
 * Document numbering (Spec 4.3–4.6).
 *
 * Every customer-facing document is `PREFIX-YYYY-####`, restarting at
 * 0001 each calendar year. The number itself is reserved in the
 * database by `next_document_number`, which holds a row lock so two
 * staff saving at the same moment cannot be handed the same one; this
 * module only knows the shape, so it can be tested and reused for the
 * booking, agreement, and order numbers of later milestones.
 */

export const DOCUMENT_PREFIXES = {
  quotation: "QT",
  booking: "BK",
  agreement: "RA",
  order: "OR",
} as const;

export type DocumentKind = keyof typeof DOCUMENT_PREFIXES;
export type DocumentPrefix = (typeof DOCUMENT_PREFIXES)[DocumentKind];

/** Sequence width — QT-2026-0001. Numbers past 9999 simply get longer. */
const SEQUENCE_DIGITS = 4;

const DOCUMENT_NUMBER_PATTERN = /^([A-Z]{2})-(\d{4})-(\d{4,})$/;

export function formatDocumentNumber(
  prefix: DocumentPrefix,
  year: number,
  sequence: number,
): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new RangeError(`year must be a four-digit year, got ${year}`);
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`sequence must be 1 or more, got ${sequence}`);
  }

  const padded = String(sequence).padStart(SEQUENCE_DIGITS, "0");
  return `${prefix}-${year}-${padded}`;
}

export type ParsedDocumentNumber = {
  prefix: string;
  year: number;
  sequence: number;
};

/** Reads a document number apart, or null when it is not one. */
export function parseDocumentNumber(
  value: string,
): ParsedDocumentNumber | null {
  const match = DOCUMENT_NUMBER_PATTERN.exec(value.trim().toUpperCase());
  if (!match) return null;

  return {
    prefix: match[1],
    year: Number.parseInt(match[2], 10),
    sequence: Number.parseInt(match[3], 10),
  };
}

/** True when `value` is a document number of the given kind. */
export function isDocumentNumber(value: string, kind: DocumentKind): boolean {
  const parsed = parseDocumentNumber(value);
  return parsed !== null && parsed.prefix === DOCUMENT_PREFIXES[kind];
}

/**
 * Filename for a downloaded PDF — `QT-2026-0001.pdf`.
 *
 * Anything that is not a document number is refused rather than
 * sanitised: the value reaches a Content-Disposition header, and a
 * stray quote or newline there is a header-injection bug.
 */
export function documentFilename(
  documentNumber: string,
  extension = "pdf",
): string {
  if (!parseDocumentNumber(documentNumber)) {
    throw new RangeError(`not a document number: ${documentNumber}`);
  }
  return `${documentNumber.trim().toUpperCase()}.${extension}`;
}
