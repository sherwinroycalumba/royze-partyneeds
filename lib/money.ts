/**
 * Money handling (Spec 5).
 *
 * Every amount in this system is an INTEGER NUMBER OF CENTAVOS. Floats
 * are never used for money — ₱0.1 + ₱0.2 must equal ₱0.30 exactly, and
 * every booking must reconcile to the centavo.
 */

export const CENTAVOS_PER_PESO = 100;

/** Thrown when a value that must be exact money is not. */
export class MoneyError extends Error {}

/** Guards that a value really is an integer centavo amount. */
export function assertCentavos(value: number, label = "amount"): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new MoneyError(
      `${label} must be an integer number of centavos, got ${value}`,
    );
  }
  return value;
}

/**
 * Parses user input ("1,234.56", "₱1234.5", "1234") into centavos.
 * Returns null when the input is not a valid amount.
 */
export function parsePesoInput(input: string): number | null {
  const cleaned = input.replace(/[₱,\s]/g, "").trim();
  if (cleaned === "") return null;
  if (!/^-?\d*(\.\d{0,2})?$/.test(cleaned)) return null;

  const negative = cleaned.startsWith("-");
  const [whole, fraction = ""] = cleaned.replace("-", "").split(".");
  const pesos = whole === "" ? 0 : Number.parseInt(whole, 10);
  const centavos = Number.parseInt(fraction.padEnd(2, "0") || "0", 10);

  if (Number.isNaN(pesos) || Number.isNaN(centavos)) return null;

  const total = pesos * CENTAVOS_PER_PESO + centavos;
  return negative ? -total : total;
}

/** Converts centavos to a plain decimal string, e.g. 123456 → "1234.56". */
export function centavosToDecimalString(centavos: number): string {
  assertCentavos(centavos);
  const negative = centavos < 0;
  const absolute = Math.abs(centavos);
  const pesos = Math.floor(absolute / CENTAVOS_PER_PESO);
  const remainder = absolute % CENTAVOS_PER_PESO;
  return `${negative ? "-" : ""}${pesos}.${String(remainder).padStart(2, "0")}`;
}

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats centavos for display: 123456 → "₱1,234.56" (Spec 5). */
export function formatPeso(centavos: number): string {
  assertCentavos(centavos);
  const negative = centavos < 0;
  const absolute = Math.abs(centavos);
  const formatted = pesoFormatter.format(absolute / CENTAVOS_PER_PESO);
  return `${negative ? "-" : ""}₱${formatted}`;
}

/** Sums centavo amounts exactly. */
export function sumCentavos(amounts: readonly number[]): number {
  return amounts.reduce<number>((total, amount) => {
    assertCentavos(amount);
    return total + amount;
  }, 0);
}

/** Multiplies a unit price by a whole quantity. */
export function multiplyCentavos(unit: number, quantity: number): number {
  assertCentavos(unit, "unit price");
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new MoneyError(`quantity must be a non-negative integer, got ${quantity}`);
  }
  return unit * quantity;
}

/**
 * Applies a percentage to a centavo amount, rounding half-up to the
 * nearest centavo. Used for the 50% downpayment rule and discounts.
 *
 * Half-up (not banker's rounding) matches what staff compute by hand.
 */
export function percentOfCentavos(centavos: number, percent: number): number {
  assertCentavos(centavos);
  if (!Number.isFinite(percent)) {
    throw new MoneyError(`percent must be finite, got ${percent}`);
  }

  // Scale to avoid binary floating point drift on values like 12.5%.
  const scaled = Math.round(centavos * percent * 1000) / 1000;
  return Math.sign(scaled) * Math.round(Math.abs(scaled) / 100);
}

/**
 * The downpayment required to confirm a booking (Spec 4.4).
 * Defaults to 50%, configurable in Settings.
 */
export function downpaymentRequired(
  totalCentavos: number,
  percent: number,
): number {
  return percentOfCentavos(totalCentavos, percent);
}

/**
 * The 50%-confirmation gate (Spec 4.4): do verified payments cover the
 * required downpayment? Compared in exact integer centavos.
 */
export function meetsDownpayment(
  totalCentavos: number,
  verifiedPaidCentavos: number,
  percent: number,
): boolean {
  assertCentavos(verifiedPaidCentavos, "verified payments");
  return verifiedPaidCentavos >= downpaymentRequired(totalCentavos, percent);
}

/** Outstanding balance on a booking or order. */
export function balanceDue(
  totalCentavos: number,
  verifiedPaidCentavos: number,
): number {
  assertCentavos(totalCentavos, "total");
  assertCentavos(verifiedPaidCentavos, "verified payments");
  return totalCentavos - verifiedPaidCentavos;
}
