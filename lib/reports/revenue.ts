import { sumCentavos } from "@/lib/money";

/**
 * Cash-basis revenue recognition (Spec 4.11).
 *
 * Revenue counts when a payment is **verified**, never when a booking
 * is made. But a payment arrives as one number against a basket of
 * rental items, sale items, a backdrop package, a delivery fee, and
 * possibly a damage charge — and the P&L wants those apart.
 *
 * So a verified payment is split across the booking's revenue mix in
 * proportion to what that booking was for. A half-paid booking
 * recognises half of each of its sources, which is the honest reading
 * of a part payment: the customer has not paid "the chairs first".
 */

export type RevenueSource =
  | "rental"
  | "sale"
  | "package"
  | "damage"
  | "delivery";

export const REVENUE_SOURCES: readonly RevenueSource[] = [
  "rental",
  "sale",
  "package",
  "damage",
  "delivery",
];

export const REVENUE_SOURCE_LABELS: Record<RevenueSource, string> = {
  rental: "Rental income",
  sale: "Sales income",
  package: "Backdrop package income",
  damage: "Damage & loss charges",
  delivery: "Delivery & pickup fees",
};

export type RevenueMix = Record<RevenueSource, number>;

export function emptyMix(): RevenueMix {
  return { rental: 0, sale: 0, package: 0, damage: 0, delivery: 0 };
}

export function addMix(a: RevenueMix, b: RevenueMix): RevenueMix {
  const total = emptyMix();
  for (const source of REVENUE_SOURCES) {
    total[source] = a[source] + b[source];
  }
  return total;
}

export function mixTotal(mix: RevenueMix): number {
  return sumCentavos(REVENUE_SOURCES.map((source) => mix[source]));
}

/**
 * Splits an amount across weights so the parts sum to *exactly* the
 * amount — largest-remainder, not naive rounding.
 *
 * Rounding each share independently loses or invents centavos, and a
 * P&L whose revenue lines do not add up to the cash received is worse
 * than no P&L at all.
 */
export function allocateProportionally(
  amount: number,
  weights: readonly number[],
): number[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  if (totalWeight <= 0 || amount === 0) {
    return weights.map(() => 0);
  }

  const exact = weights.map((weight) => (amount * weight) / totalWeight);
  const floors = exact.map(Math.floor);
  const allocated = floors.reduce((sum, value) => sum + value, 0);

  // Hand the leftover centavos to whichever shares were cut hardest.
  const order = exact
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder);

  const result = [...floors];
  let leftover = amount - allocated;

  for (const { index } of order) {
    if (leftover <= 0) break;
    result[index] += 1;
    leftover -= 1;
  }

  return result;
}

export type RevenueLine = {
  /** Which bucket this line's money belongs in. */
  source: RevenueSource;
  amount_centavos: number;
};

/**
 * What a document was *for*, before considering what has been paid.
 *
 * The whole-document discount comes off proportionally: a ₱500
 * discount on a booking that is two-thirds chairs reduces rental
 * income by ₱333.34, not the delivery fee.
 */
export function documentRevenueMix(
  lines: readonly RevenueLine[],
  discountCentavos: number,
): RevenueMix {
  const mix = emptyMix();
  for (const line of lines) {
    mix[line.source] += line.amount_centavos;
  }

  const gross = mixTotal(mix);
  const discount = Math.min(Math.max(0, discountCentavos), gross);
  if (discount === 0) return mix;

  const shares = allocateProportionally(
    discount,
    REVENUE_SOURCES.map((source) => mix[source]),
  );

  const net = emptyMix();
  REVENUE_SOURCES.forEach((source, index) => {
    net[source] = mix[source] - shares[index];
  });

  return net;
}

/**
 * The revenue a verified payment recognises, split across the mix it
 * was paid against. Overpayment recognises no more than the document
 * was worth — the excess is a credit, not income.
 */
export function recogniseRevenue(
  verifiedPaidCentavos: number,
  mix: RevenueMix,
): RevenueMix {
  const total = mixTotal(mix);
  if (total <= 0 || verifiedPaidCentavos <= 0) return emptyMix();

  const recognised = Math.min(verifiedPaidCentavos, total);
  const shares = allocateProportionally(
    recognised,
    REVENUE_SOURCES.map((source) => mix[source]),
  );

  const result = emptyMix();
  REVENUE_SOURCES.forEach((source, index) => {
    result[source] = shares[index];
  });

  return result;
}
