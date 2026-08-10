"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";

import {
  createQuotationAction,
  updateQuotationAction,
  type QuotationState,
} from "@/lib/quotations/actions";
import {
  lineTotal,
  quotationTotals,
  type LineDraft,
} from "@/lib/quotations/totals";
import { centavosToDecimalString, formatPeso, parsePesoInput } from "@/lib/money";
import type {
  Customer,
  QuotationItem,
  QuotationLineType,
} from "@/lib/supabase/database.types";
import {
  Banner,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { Button, buttonClasses } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * The quotation builder (Spec 4.3).
 *
 * Totals are computed here with the very same pure functions the server
 * action and the PDF use, so the figure staff read out to a customer on
 * the phone is the figure that gets saved and printed.
 */

/** A catalog item or package, as offered in the line picker. */
export type PickerOption = {
  /** "item:<uuid>" or "package:<uuid>" — unique across both lists. */
  key: string;
  id: string;
  kind: "item" | "package";
  line_type: QuotationLineType;
  label: string;
  group: string;
  unit_price_centavos: number;
  /** Printed under a package line on the document (Spec 4.4). */
  component_summary: string;
};

/** Everything the builder needs that does not come from the form. */
export type BuilderDefaults = {
  issue_date: string;
  valid_until: string;
  downpayment_percent: number;
  free_delivery_area: string;
  suggestedFees: { area: string; fee_centavos: number }[];
};

type Row = {
  /** Stable across re-renders so React keys survive a row removal. */
  uid: number;
  optionKey: string;
  line_type: QuotationLineType;
  ref: string;
  description: string;
  component_summary: string;
  quantity: string;
  unit_price: string;
  discount: string;
};

let nextUid = 1;

function blankRow(): Row {
  return {
    uid: nextUid++,
    optionKey: "",
    line_type: "custom",
    ref: "",
    description: "",
    component_summary: "",
    quantity: "1",
    unit_price: "",
    discount: "",
  };
}

function rowsFromItems(items: readonly QuotationItem[]): Row[] {
  if (items.length === 0) return [blankRow()];

  return items.map((item) => ({
    uid: nextUid++,
    optionKey:
      item.line_type === "package"
        ? item.package_id
          ? `package:${item.package_id}`
          : ""
        : item.catalog_item_id
          ? `item:${item.catalog_item_id}`
          : "",
    line_type: item.line_type,
    ref: item.package_id ?? item.catalog_item_id ?? "",
    description: item.description,
    component_summary: item.component_summary,
    quantity: String(item.quantity),
    unit_price: centavosToDecimalString(item.unit_price_centavos),
    discount:
      item.line_discount_centavos > 0
        ? centavosToDecimalString(item.line_discount_centavos)
        : "",
  }));
}

/** Blank reads as ₱0.00; junk reads as 0 so the running total stays sane. */
function amount(value: string): number {
  const parsed = parsePesoInput(value);
  return parsed === null ? 0 : Math.max(0, parsed);
}

function count(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function toLineDraft(row: Row): LineDraft {
  return {
    line_type: row.line_type,
    description: row.description,
    quantity: count(row.quantity),
    unit_price_centavos: amount(row.unit_price),
    line_discount_centavos: amount(row.discount),
  };
}

export function QuotationBuilder({
  mode,
  quotationId,
  customers,
  options,
  defaults,
  initial,
  initialItems,
}: {
  mode: "create" | "edit";
  quotationId?: string;
  customers: Customer[];
  options: PickerOption[];
  defaults: BuilderDefaults;
  initial?: {
    customer_id: string;
    issue_date: string;
    valid_until: string;
    event_date: string | null;
    event_address: string;
    occasion: string;
    within_free_delivery_area: boolean;
    delivery_fee_centavos: number;
    delivery_fee_override_reason: string;
    discount_centavos: number;
    downpayment_percent: number;
    notes: string;
    internal_notes: string;
  };
  initialItems?: readonly QuotationItem[];
}) {
  const [state, formAction] = useActionState<QuotationState, FormData>(
    mode === "create" ? createQuotationAction : updateQuotationAction,
    {},
  );

  const [rows, setRows] = useState<Row[]>(() =>
    rowsFromItems(initialItems ?? []),
  );
  const [withinFreeArea, setWithinFreeArea] = useState(
    initial?.within_free_delivery_area ?? false,
  );
  const [deliveryFee, setDeliveryFee] = useState(
    initial ? centavosToDecimalString(initial.delivery_fee_centavos) : "",
  );
  const [discount, setDiscount] = useState(
    initial && initial.discount_centavos > 0
      ? centavosToDecimalString(initial.discount_centavos)
      : "",
  );
  const [downpaymentPercent, setDownpaymentPercent] = useState(
    String(initial?.downpayment_percent ?? defaults.downpayment_percent),
  );

  const grouped = useMemo(() => {
    const groups = new Map<string, PickerOption[]>();
    for (const option of options) {
      const list = groups.get(option.group) ?? [];
      list.push(option);
      groups.set(option.group, list);
    }
    return [...groups.entries()];
  }, [options]);

  const totals = useMemo(
    () =>
      quotationTotals({
        lines: rows.map(toLineDraft),
        within_free_delivery_area: withinFreeArea,
        delivery_fee_centavos: amount(deliveryFee),
        discount_centavos: amount(discount),
        downpayment_percent: Number.parseFloat(downpaymentPercent) || 0,
      }),
    [rows, withinFreeArea, deliveryFee, discount, downpaymentPercent],
  );

  function updateRow(uid: number, patch: Partial<Row>) {
    setRows((current) =>
      current.map((row) => (row.uid === uid ? { ...row, ...patch } : row)),
    );
  }

  /** Picking a catalogued item fills in its name and current price. */
  function pickOption(uid: number, optionKey: string) {
    const option = options.find((candidate) => candidate.key === optionKey);

    if (!option) {
      updateRow(uid, {
        optionKey: "",
        line_type: "custom",
        ref: "",
        component_summary: "",
      });
      return;
    }

    updateRow(uid, {
      optionKey,
      line_type: option.line_type,
      ref: option.id,
      description: option.label,
      component_summary: option.component_summary,
      // The catalog price is a starting point — staff may quote another,
      // and the line stores whatever they settle on.
      unit_price: centavosToDecimalString(option.unit_price_centavos),
    });
  }

  return (
    <form action={formAction} className="space-y-5">
      {mode === "edit" && quotationId && (
        <input type="hidden" name="quotation_id" value={quotationId} />
      )}

      {state.error && <Banner tone="error">{state.error}</Banner>}
      {state.success && <Banner tone="success">{state.success}</Banner>}

      {/* ── Customer and event ───────────────────────────────── */}
      <Card>
        <CardHeader
          title="Customer and event"
          description="Who it is for and when — the event date carries over when this becomes a booking."
        />
        <CardBody className="space-y-4">
          <Field label="Customer" htmlFor="customer_id" required>
            <Select
              id="customer_id"
              name="customer_id"
              defaultValue={initial?.customer_id ?? ""}
              required
            >
              <option value="">Choose a customer…</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                  {customer.phone ? ` · ${customer.phone}` : ""}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quotation date" htmlFor="issue_date" required>
              <TextInput
                id="issue_date"
                name="issue_date"
                type="date"
                defaultValue={initial?.issue_date ?? defaults.issue_date}
                required
              />
            </Field>

            <Field
              label="Valid until"
              htmlFor="valid_until"
              hint="After this date the quotation shows as expired."
              required
            >
              <TextInput
                id="valid_until"
                name="valid_until"
                type="date"
                defaultValue={initial?.valid_until ?? defaults.valid_until}
                required
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Event date" htmlFor="event_date">
              <TextInput
                id="event_date"
                name="event_date"
                type="date"
                defaultValue={initial?.event_date ?? ""}
              />
            </Field>

            <Field
              label="Occasion"
              htmlFor="occasion"
              hint="e.g. 7th Birthday — Safari theme"
            >
              <TextInput
                id="occasion"
                name="occasion"
                defaultValue={initial?.occasion ?? ""}
              />
            </Field>
          </div>

          <Field label="Delivery address" htmlFor="event_address">
            <TextArea
              id="event_address"
              name="event_address"
              rows={2}
              defaultValue={initial?.event_address ?? ""}
            />
          </Field>
        </CardBody>
      </Card>

      {/* ── Items ────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Items"
          description="Pick from the catalog, or type a one-off line. Prices are copied in and stay fixed on this quotation."
        />
        <CardBody className="space-y-4">
          {rows.map((row, index) => (
            <LineRow
              key={row.uid}
              row={row}
              index={index}
              grouped={grouped}
              canRemove={rows.length > 1}
              onPick={(optionKey) => pickOption(row.uid, optionKey)}
              onChange={(patch) => updateRow(row.uid, patch)}
              onRemove={() =>
                setRows((current) =>
                  current.filter((candidate) => candidate.uid !== row.uid),
                )
              }
            />
          ))}

          <Button
            type="button"
            variant="secondary"
            onClick={() => setRows((current) => [...current, blankRow()])}
          >
            + Add item
          </Button>
        </CardBody>
      </Card>

      {/* ── Money ────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Delivery, discount, and downpayment"
          description="Delivery and pickup are free inside your service area (Spec 4.4)."
        />
        <CardBody className="space-y-4">
          <label className="flex items-start gap-3 rounded-lg border border-ink-200 p-3">
            {/* An unchecked box posts nothing, which the server reads
                as false — exactly the intent. */}
            <input
              type="checkbox"
              name="within_free_delivery_area"
              checked={withinFreeArea}
              onChange={(event) => {
                setWithinFreeArea(event.target.checked);
                if (event.target.checked) setDeliveryFee("");
              }}
              className="mt-0.5 size-5 accent-brand-600"
            />
            <span>
              <span className="block text-sm font-medium text-ink-800">
                Within {defaults.free_delivery_area || "the free-delivery area"}
              </span>
              <span className="block text-xs text-ink-500">
                Locks the fee to ₱0.00 and prints “FREE Delivery &amp; Pickup”
                on the PDF.
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Delivery & pickup fee"
              htmlFor="delivery_fee"
              hint={
                withinFreeArea
                  ? "Free inside the service area."
                  : suggestedFeeHint(defaults.suggestedFees)
              }
            >
              <TextInput
                id="delivery_fee"
                name="delivery_fee"
                inputMode="decimal"
                placeholder="0.00"
                value={withinFreeArea ? "" : deliveryFee}
                onChange={(event) => setDeliveryFee(event.target.value)}
                disabled={withinFreeArea}
              />
            </Field>

            <Field
              label="Discount on the whole quotation"
              htmlFor="discount"
              hint="On top of any per-line discounts."
            >
              <TextInput
                id="discount"
                name="discount"
                inputMode="decimal"
                placeholder="0.00"
                value={discount}
                onChange={(event) => setDiscount(event.target.value)}
              />
            </Field>
          </div>

          {!withinFreeArea && (
            <Field
              label="Reason, if this is not the usual fee"
              htmlFor="delivery_fee_override_reason"
              hint="Logged against the quotation."
            >
              <TextInput
                id="delivery_fee_override_reason"
                name="delivery_fee_override_reason"
                defaultValue={initial?.delivery_fee_override_reason ?? ""}
              />
            </Field>
          )}

          <Field
            label="Downpayment to confirm (%)"
            htmlFor="downpayment_percent"
            hint="Defaults to the percentage set under Settings."
          >
            <TextInput
              id="downpayment_percent"
              name="downpayment_percent"
              inputMode="decimal"
              value={downpaymentPercent}
              onChange={(event) => setDownpaymentPercent(event.target.value)}
              className="max-w-32"
            />
          </Field>
        </CardBody>
      </Card>

      {/* ── Running total ────────────────────────────────────── */}
      <Card>
        <CardHeader title="Total" />
        <CardBody>
          <dl className="space-y-1.5 text-sm">
            <TotalRow
              label="Subtotal"
              value={formatPeso(totals.subtotal_centavos)}
            />
            {totals.discount_centavos > 0 && (
              <TotalRow
                label="Discount"
                value={`−${formatPeso(totals.discount_centavos)}`}
              />
            )}
            <TotalRow
              label="Delivery & pickup"
              value={
                withinFreeArea
                  ? "FREE"
                  : formatPeso(totals.delivery_fee_centavos)
              }
            />
            <div className="flex items-baseline justify-between border-t border-ink-200 pt-2">
              <dt className="text-base font-bold text-ink-900">Total</dt>
              <dd className="tabular text-xl font-bold text-brand-700">
                {formatPeso(totals.total_centavos)}
              </dd>
            </div>
            <TotalRow
              label={`${downpaymentPercent || 0}% downpayment to confirm`}
              value={formatPeso(totals.downpayment_centavos)}
            />
          </dl>
        </CardBody>
      </Card>

      {/* ── Notes ────────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Notes" />
        <CardBody className="space-y-4">
          <Field
            label="Notes for the customer"
            htmlFor="notes"
            hint="Printed on the PDF."
          >
            <TextArea
              id="notes"
              name="notes"
              rows={2}
              defaultValue={initial?.notes ?? ""}
            />
          </Field>

          <Field
            label="Internal notes"
            htmlFor="internal_notes"
            hint="Never printed — for the team only."
          >
            <TextArea
              id="internal_notes"
              name="internal_notes"
              rows={2}
              defaultValue={initial?.internal_notes ?? ""}
            />
          </Field>
        </CardBody>
        <CardFooter>
          <Link
            href={quotationId ? `/quotations/${quotationId}` : "/quotations"}
            className={buttonClasses("ghost")}
          >
            Cancel
          </Link>
          <SubmitButton pendingLabel="Saving…">
            {mode === "create" ? "Save quotation" : "Save changes"}
          </SubmitButton>
        </CardFooter>
      </Card>
    </form>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-ink-600">{label}</dt>
      <dd className="tabular font-semibold text-ink-900">{value}</dd>
    </div>
  );
}

function suggestedFeeHint(
  fees: readonly { area: string; fee_centavos: number }[],
): string {
  if (fees.length === 0) return "Charged for locations outside the area.";
  const shown = fees
    .slice(0, 3)
    .map((fee) => `${fee.area} ${formatPeso(fee.fee_centavos)}`)
    .join(" · ");
  return `Suggested: ${shown}`;
}

/** One repeatable item row. */
function LineRow({
  row,
  index,
  grouped,
  canRemove,
  onPick,
  onChange,
  onRemove,
}: {
  row: Row;
  index: number;
  grouped: [string, PickerOption[]][];
  canRemove: boolean;
  onPick: (optionKey: string) => void;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
}) {
  const total = lineTotal(toLineDraft(row));
  const id = `line-${row.uid}`;

  return (
    <div className="space-y-3 rounded-xl border border-ink-200 p-3">
      {/* Parallel arrays: every row posts one entry per field, so the
          indexes line up on the server even when a row is removed. */}
      <input type="hidden" name="line_type" value={row.line_type} />
      <input type="hidden" name="line_ref" value={row.ref} />
      <input
        type="hidden"
        name="line_summary"
        value={row.component_summary}
      />

      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-ink-500">
          Line {index + 1}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md px-2 py-1 text-xs font-semibold text-danger-600 transition-colors hover:bg-danger-50"
          >
            Remove
          </button>
        )}
      </div>

      <Field label="Item" htmlFor={`${id}-option`}>
        <Select
          id={`${id}-option`}
          value={row.optionKey}
          onChange={(event) => onPick(event.target.value)}
        >
          <option value="">Custom line — type it below</option>
          {grouped.map(([group, groupOptions]) => (
            <optgroup key={group} label={group}>
              {groupOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label} · {formatPeso(option.unit_price_centavos)}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>

      <Field label="Description" htmlFor={`${id}-description`} required>
        <TextInput
          id={`${id}-description`}
          name="line_description"
          value={row.description}
          onChange={(event) => onChange({ description: event.target.value })}
          placeholder="What the customer sees on the PDF"
          required
        />
      </Field>

      {row.component_summary && (
        <p className="text-xs text-ink-500">
          Includes: {row.component_summary}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Qty" htmlFor={`${id}-quantity`} required>
          <TextInput
            id={`${id}-quantity`}
            name="line_quantity"
            inputMode="numeric"
            value={row.quantity}
            onChange={(event) => onChange({ quantity: event.target.value })}
            required
          />
        </Field>

        <Field label="Unit price" htmlFor={`${id}-price`} required>
          <TextInput
            id={`${id}-price`}
            name="line_unit_price"
            inputMode="decimal"
            placeholder="0.00"
            value={row.unit_price}
            onChange={(event) => onChange({ unit_price: event.target.value })}
            required
          />
        </Field>

        <Field label="Discount" htmlFor={`${id}-discount`}>
          <TextInput
            id={`${id}-discount`}
            name="line_discount"
            inputMode="decimal"
            placeholder="0.00"
            value={row.discount}
            onChange={(event) => onChange({ discount: event.target.value })}
          />
        </Field>

        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-ink-700">Amount</span>
          <p className="tabular px-3 py-2.5 text-[16px] font-bold text-ink-900">
            {formatPeso(total)}
          </p>
        </div>
      </div>
    </div>
  );
}
