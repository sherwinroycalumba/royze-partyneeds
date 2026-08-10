"use client";

import { useActionState, useMemo, useState } from "react";

import { createOrderAction, type OrderState } from "@/lib/orders/actions";
import { orderTotals } from "@/lib/orders/totals";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  expectsReference,
} from "@/lib/payments/methods";
import { centavosToDecimalString, formatPeso, parsePesoInput } from "@/lib/money";
import type { Customer, PaymentMethod } from "@/lib/supabase/database.types";
import { Banner, Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { matchesQuery } from "@/components/ui/list-search";

/**
 * The quick-sale screen (Spec 4.6).
 *
 * "Must take under ~30 seconds so quick sales actually get recorded."
 * Everything is on one screen and nothing is required beyond tapping
 * an item and a payment method: the customer defaults to Walk-in, the
 * date to today, and the price to the catalog's.
 */

export type SaleItem = {
  id: string;
  name: string;
  category: string;
  sale_price_centavos: number;
  stock_quantity: number;
  low_stock_threshold: number;
};

type CartLine = {
  uid: number;
  itemId: string | null;
  description: string;
  quantity: number;
  unitPrice: string;
  discount: string;
  /** What the catalog thought was on the shelf when it was added. */
  stockAtAdd: number | null;
};

let nextUid = 1;

export function PointOfSale({
  items,
  customers,
  today,
}: {
  items: SaleItem[];
  customers: Customer[];
  today: string;
}) {
  const [state, formAction] = useActionState<OrderState, FormData>(
    createOrderAction,
    {},
  );

  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [linkCustomer, setLinkCustomer] = useState(false);

  const results = useMemo(() => {
    if (!query.trim()) return items.slice(0, 8);
    return items
      .filter((item) => matchesQuery(query, [item.name, item.category]))
      .slice(0, 12);
  }, [items, query]);

  const totals = useMemo(
    () =>
      orderTotals({
        lines: cart.map((line) => ({
          quantity: line.quantity,
          unit_price_centavos: amount(line.unitPrice),
          line_discount_centavos: amount(line.discount),
        })),
        discount_centavos: amount(discount),
      }),
    [cart, discount],
  );

  /** Tapping an item adds it, or bumps the quantity if already there. */
  function addItem(item: SaleItem) {
    setCart((current) => {
      const existing = current.find((line) => line.itemId === item.id);
      if (existing) {
        return current.map((line) =>
          line.uid === existing.uid
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      }

      return [
        ...current,
        {
          uid: nextUid++,
          itemId: item.id,
          description: item.name,
          quantity: 1,
          unitPrice: centavosToDecimalString(item.sale_price_centavos),
          discount: "",
          stockAtAdd: item.stock_quantity,
        },
      ];
    });
    setQuery("");
  }

  function updateLine(uid: number, patch: Partial<CartLine>) {
    setCart((current) =>
      current.map((line) => (line.uid === uid ? { ...line, ...patch } : line)),
    );
  }

  const oversold = cart.filter(
    (line) => line.stockAtAdd !== null && line.quantity > line.stockAtAdd,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="sold_on" value={today} />

      {state.error && <Banner tone="error">{state.error}</Banner>}

      {/* ── Search and tap to add ────────────────────────────── */}
      <Card>
        <CardBody className="space-y-3">
          <TextInput
            id="pos-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search an item to sell…"
            autoComplete="off"
            aria-label="Search items"
          />

          <div className="flex flex-wrap gap-2">
            {results.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => addItem(item)}
                className="rounded-xl border border-ink-300 px-3 py-2 text-left transition-colors hover:border-brand-600 hover:bg-brand-50"
              >
                <span className="block text-sm font-semibold text-ink-900">
                  {item.name}
                </span>
                <span className="tabular block text-xs text-ink-600">
                  {formatPeso(item.sale_price_centavos)} ·{" "}
                  <span
                    className={
                      item.stock_quantity <= item.low_stock_threshold
                        ? "font-semibold text-warning-700"
                        : ""
                    }
                  >
                    {item.stock_quantity} left
                  </span>
                </span>
              </button>
            ))}
            {results.length === 0 && (
              <p className="text-sm text-ink-500">
                No sale item matches “{query.trim()}”.
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      {/* ── The cart ─────────────────────────────────────────── */}
      {cart.length > 0 && (
        <Card>
          <CardBody className="space-y-3">
            {cart.map((line) => (
              <div
                key={line.uid}
                className="space-y-2 rounded-xl border border-ink-200 p-3"
              >
                <input type="hidden" name="line_ref" value={line.itemId ?? ""} />
                <input
                  type="hidden"
                  name="line_description"
                  value={line.description}
                />
                <input
                  type="hidden"
                  name="line_quantity"
                  value={line.quantity}
                />
                <input
                  type="hidden"
                  name="line_unit_price"
                  value={line.unitPrice}
                />
                <input
                  type="hidden"
                  name="line_discount"
                  value={line.discount || "0"}
                />

                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink-900">
                    {line.description}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setCart((current) =>
                        current.filter((row) => row.uid !== line.uid),
                      )
                    }
                    className="rounded-md px-2 py-1 text-xs font-semibold text-danger-600 hover:bg-danger-50"
                  >
                    Remove
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Steppers, not a keyboard: this is the fast path. */}
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        updateLine(line.uid, {
                          quantity: Math.max(1, line.quantity - 1),
                        })
                      }
                      aria-label={`One fewer ${line.description}`}
                    >
                      −
                    </Button>
                    <span className="tabular w-10 text-center font-semibold">
                      {line.quantity}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        updateLine(line.uid, { quantity: line.quantity + 1 })
                      }
                      aria-label={`One more ${line.description}`}
                    >
                      +
                    </Button>
                  </div>

                  <TextInput
                    value={line.unitPrice}
                    onChange={(event) =>
                      updateLine(line.uid, { unitPrice: event.target.value })
                    }
                    inputMode="decimal"
                    aria-label={`Unit price for ${line.description}`}
                    className="max-w-28"
                  />

                  <span className="tabular ml-auto font-bold text-ink-900">
                    {formatPeso(
                      Math.max(
                        0,
                        amount(line.unitPrice) * line.quantity -
                          amount(line.discount),
                      ),
                    )}
                  </span>
                </div>

                {line.stockAtAdd !== null &&
                  line.quantity > line.stockAtAdd && (
                    <p className="text-xs font-medium text-warning-700">
                      Only {line.stockAtAdd} on record. The sale will still be
                      saved — recount the shelf afterwards.
                    </p>
                  )}
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {/* ── Pay ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader title={`Total ${formatPeso(totals.total_centavos)}`} />
        <CardBody className="space-y-4">
          {oversold.length > 0 && (
            <Banner tone="warning">
              Some items are being sold below their recorded stock. The sale is
              still recorded — the count needs checking.
            </Banner>
          )}

          <Field label="Discount" htmlFor="discount">
            <TextInput
              id="discount"
              name="discount"
              inputMode="decimal"
              placeholder="0.00"
              value={discount}
              onChange={(event) => setDiscount(event.target.value)}
              className="max-w-40"
            />
          </Field>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink-700">
              Paid with
            </legend>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((value) => (
                <label
                  key={value}
                  className={`cursor-pointer rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                    method === value
                      ? "border-brand-600 bg-brand-50 text-brand-700"
                      : "border-ink-300 text-ink-700 hover:bg-ink-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="method"
                    value={value}
                    checked={method === value}
                    onChange={() => setMethod(value)}
                    className="sr-only"
                  />
                  {PAYMENT_METHOD_LABELS[value]}
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-500">
              {method === "cash"
                ? "Cash is verified as soon as it is recorded."
                : "Waits for the owner to check the account before it counts as paid."}
            </p>
          </fieldset>

          {expectsReference(method) && (
            <Field label="Reference number" htmlFor="reference_number" required>
              <TextInput
                id="reference_number"
                name="reference_number"
                required
              />
            </Field>
          )}

          {/* Walk-in by default; linking a customer is the exception. */}
          {linkCustomer ? (
            <Field label="Customer" htmlFor="customer_id">
              <Select id="customer_id" name="customer_id" defaultValue="">
                <option value="">Walk-in</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                    {customer.phone ? ` · ${customer.phone}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="customer_label" value="Walk-in" />
              <span className="text-sm text-ink-600">Sale to Walk-in.</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setLinkCustomer(true)}
              >
                Link a customer
              </Button>
            </div>
          )}

          {linkCustomer && (
            <Field
              label="Name on the receipt"
              htmlFor="customer_label"
              hint="Used when no customer is linked."
            >
              <TextInput
                id="customer_label"
                name="customer_label"
                defaultValue="Walk-in"
              />
            </Field>
          )}

          <Field label="Notes" htmlFor="notes">
            <TextArea id="notes" name="notes" rows={2} />
          </Field>

          <SubmitButton pendingLabel="Recording…">
            {cart.length === 0
              ? "Add an item first"
              : `Record sale · ${formatPeso(totals.total_centavos)}`}
          </SubmitButton>
        </CardBody>
      </Card>
    </form>
  );
}

/** Blank or junk reads as ₱0.00 so the running total stays sane. */
function amount(value: string): number {
  const parsed = parsePesoInput(value);
  return parsed === null ? 0 : Math.max(0, parsed);
}
