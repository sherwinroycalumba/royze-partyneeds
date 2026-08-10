"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";

import {
  createBookingAction,
  updateBookingAction,
  type BookingState,
} from "@/lib/bookings/actions";
import type { BookingLineDraft } from "@/lib/bookings/validation";
import type { PickerOption } from "@/lib/catalog/picker";
import { documentTotals, lineTotal } from "@/lib/documents/totals";
import {
  centavosToDecimalString,
  formatPeso,
  parsePesoInput,
} from "@/lib/money";
import type {
  BookingItem,
  BookingLineType,
  Customer,
  Profile,
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
import type { BookingBuilderDefaults } from "./builder-data";

/**
 * The booking builder (Spec 4.4).
 *
 * Totals come from the same pure functions the server action and the
 * documents use. The availability check is deliberately *not* mirrored
 * here — it depends on what every other booking holds, so the server
 * is the only place that can answer it honestly, and it answers on
 * save.
 */

type Row = {
  uid: number;
  optionKey: string;
  line_type: BookingLineType;
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

function rowsFromItems(items: readonly BookingItem[]): Row[] {
  // Component rows are rebuilt from the package on every save, so the
  // editor only ever shows the lines a human actually chose.
  const parents = items.filter(
    (item) => !item.is_component && item.line_type !== "damage_charge",
  );
  if (parents.length === 0) return [blankRow()];

  return parents.map((item) => ({
    uid: nextUid++,
    optionKey:
      item.line_type === "package"
        ? item.package_id
          ? `package:${item.package_id}`
          : ""
        : item.catalog_item_id
          ? `item:${item.catalog_item_id}${item.line_type === "sale" ? ":sale" : ""}`
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

function amount(value: string): number {
  const parsed = parsePesoInput(value);
  return parsed === null ? 0 : Math.max(0, parsed);
}

function count(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function toLineDraft(row: Row): BookingLineDraft {
  return {
    line_type: row.line_type,
    description: row.description,
    quantity: count(row.quantity),
    unit_price_centavos: amount(row.unit_price),
    line_discount_centavos: amount(row.discount),
    is_component: false,
  };
}

export type BookingInitial = {
  customer_id: string;
  event_date: string;
  event_start_time: string | null;
  event_end_time: string | null;
  /** Already converted to `YYYY-MM-DDTHH:mm` in Manila. */
  delivery_local: string;
  pickup_local: string;
  setup_local: string;
  teardown_local: string;
  event_address: string;
  landmark: string;
  contact_person_name: string;
  contact_person_phone: string;
  occasion: string;
  theme_motif: string;
  celebrant_name: string;
  reference_photo_urls: string[];
  within_free_delivery_area: boolean;
  delivery_fee_centavos: number;
  delivery_fee_override_reason: string;
  discount_centavos: number;
  downpayment_percent: number;
  assigned_delivery_staff: string | null;
  notes: string;
  internal_notes: string;
};

export function BookingBuilder({
  mode,
  bookingId,
  customers,
  options,
  drivers,
  defaults,
  isOwner,
  initial,
  initialItems,
}: {
  mode: "create" | "edit";
  bookingId?: string;
  customers: Customer[];
  options: PickerOption[];
  drivers: Pick<Profile, "id" | "full_name" | "email">[];
  defaults: BookingBuilderDefaults;
  /** Only the Owner may book past the stock on hand (Spec 4.4). */
  isOwner: boolean;
  initial?: BookingInitial;
  initialItems?: readonly BookingItem[];
}) {
  const [state, formAction] = useActionState<BookingState, FormData>(
    mode === "create" ? createBookingAction : updateBookingAction,
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
  const [photoUrls, setPhotoUrls] = useState<string[]>(() =>
    initial?.reference_photo_urls?.length ? initial.reference_photo_urls : [""],
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
      documentTotals({
        lines: rows.map(toLineDraft),
        within_free_delivery_area: withinFreeArea,
        delivery_fee_centavos: amount(deliveryFee),
        discount_centavos: amount(discount),
        downpayment_percent: Number.parseFloat(downpaymentPercent) || 0,
      }),
    [rows, withinFreeArea, deliveryFee, discount, downpaymentPercent],
  );

  const hasBackdrop = rows.some((row) => row.line_type === "package");
  // The server rejects an overbooking unless an Owner explains it, so
  // the box only appears for someone who could actually use it.
  const shortageBlocked = Boolean(state.error?.includes("Not enough stock"));

  function updateRow(uid: number, patch: Partial<Row>) {
    setRows((current) =>
      current.map((row) => (row.uid === uid ? { ...row, ...patch } : row)),
    );
  }

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
      unit_price: centavosToDecimalString(option.unit_price_centavos),
    });
  }

  return (
    <form action={formAction} className="space-y-5">
      {mode === "edit" && bookingId && (
        <input type="hidden" name="booking_id" value={bookingId} />
      )}

      {state.error && <Banner tone="error">{state.error}</Banner>}
      {state.success && <Banner tone="success">{state.success}</Banner>}

      {shortageBlocked && isOwner && (
        <Card>
          <CardBody>
            <Field
              label="Reason for booking past available stock"
              htmlFor="availability_override_reason"
              hint="Owner only. Saved to the audit trail."
            >
              <TextInput
                id="availability_override_reason"
                name="availability_override_reason"
                placeholder="e.g. borrowing 20 chairs from Ate Let"
              />
            </Field>
          </CardBody>
        </Card>
      )}

      {/* ── Customer and event ───────────────────────────────── */}
      <Card>
        <CardHeader
          title="Customer and event"
          description="The event date is what the calendar and the availability check both work from."
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

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Event date" htmlFor="event_date" required>
              <TextInput
                id="event_date"
                name="event_date"
                type="date"
                defaultValue={initial?.event_date ?? defaults.event_date}
                required
              />
            </Field>

            <Field label="Starts" htmlFor="event_start_time">
              <TextInput
                id="event_start_time"
                name="event_start_time"
                type="time"
                defaultValue={initial?.event_start_time ?? ""}
              />
            </Field>

            <Field label="Ends" htmlFor="event_end_time">
              <TextInput
                id="event_end_time"
                name="event_end_time"
                type="time"
                defaultValue={initial?.event_end_time ?? ""}
              />
            </Field>
          </div>

          <Field label="Occasion" htmlFor="occasion">
            <TextInput
              id="occasion"
              name="occasion"
              placeholder="7th Birthday"
              defaultValue={initial?.occasion ?? ""}
            />
          </Field>

          <Field label="Delivery address" htmlFor="event_address" required>
            <TextArea
              id="event_address"
              name="event_address"
              rows={2}
              defaultValue={initial?.event_address ?? ""}
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Landmark"
              htmlFor="landmark"
              hint="What the driver looks for."
            >
              <TextInput
                id="landmark"
                name="landmark"
                defaultValue={initial?.landmark ?? ""}
              />
            </Field>

            <Field label="Contact on site" htmlFor="contact_person_name">
              <TextInput
                id="contact_person_name"
                name="contact_person_name"
                defaultValue={initial?.contact_person_name ?? ""}
              />
            </Field>

            <Field label="Their number" htmlFor="contact_person_phone">
              <TextInput
                id="contact_person_phone"
                name="contact_person_phone"
                inputMode="tel"
                defaultValue={initial?.contact_person_phone ?? ""}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      {/* ── Schedule ─────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Delivery and pickup"
          description="Stock is held from the earliest of setup and delivery through the latest of teardown and pickup."
        />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Delivery" htmlFor="delivery_at">
              <TextInput
                id="delivery_at"
                name="delivery_at"
                type="datetime-local"
                defaultValue={initial?.delivery_local ?? ""}
              />
            </Field>

            <Field label="Pickup / return" htmlFor="pickup_at">
              <TextInput
                id="pickup_at"
                name="pickup_at"
                type="datetime-local"
                defaultValue={initial?.pickup_local ?? ""}
              />
            </Field>
          </div>

          <Field label="Assigned to" htmlFor="assigned_delivery_staff">
            <Select
              id="assigned_delivery_staff"
              name="assigned_delivery_staff"
              defaultValue={initial?.assigned_delivery_staff ?? ""}
            >
              <option value="">Not assigned yet</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.full_name || driver.email}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      {/* ── Items ────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Items"
          description="Rental items, sale items, and backdrop packages in any combination. A package reserves each of its parts."
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

      {/* ── Backdrop details, only when one is booked ────────── */}
      {hasBackdrop && (
        <Card>
          <CardHeader
            title="Backdrop details"
            description="A backdrop needs a styling crew on site, so it gets its own schedule and its own brief."
          />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Setup" htmlFor="setup_at">
                <TextInput
                  id="setup_at"
                  name="setup_at"
                  type="datetime-local"
                  defaultValue={initial?.setup_local ?? ""}
                />
              </Field>

              <Field label="Teardown" htmlFor="teardown_at">
                <TextInput
                  id="teardown_at"
                  name="teardown_at"
                  type="datetime-local"
                  defaultValue={initial?.teardown_local ?? ""}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Theme / colour motif"
                htmlFor="theme_motif"
                hint="e.g. Safari, sage green and cream"
              >
                <TextInput
                  id="theme_motif"
                  name="theme_motif"
                  defaultValue={initial?.theme_motif ?? ""}
                />
              </Field>

              <Field
                label="Celebrant"
                htmlFor="celebrant_name"
                hint="Printed on the banner."
              >
                <TextInput
                  id="celebrant_name"
                  name="celebrant_name"
                  defaultValue={initial?.celebrant_name ?? ""}
                />
              </Field>
            </div>

            <div className="space-y-2">
              <span className="block text-sm font-medium text-ink-700">
                Reference photos
              </span>
              <p className="text-xs text-ink-500">
                Links to the peg or design the customer sent.
              </p>
              {photoUrls.map((url, index) => (
                <TextInput
                  key={index}
                  name="reference_photo_url"
                  inputMode="url"
                  placeholder="https://…"
                  value={url}
                  onChange={(event) =>
                    setPhotoUrls((current) =>
                      current.map((existing, position) =>
                        position === index ? event.target.value : existing,
                      ),
                    )
                  }
                />
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPhotoUrls((current) => [...current, ""])}
              >
                + Add another link
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Money ────────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Delivery fee, discount, and downpayment" />
        <CardBody className="space-y-4">
          <label className="flex items-start gap-3 rounded-lg border border-ink-200 p-3">
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
                on the documents.
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

            <Field label="Discount on the whole booking" htmlFor="discount">
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
              hint="Logged against the booking."
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
            hint="Verified payments must reach this before the booking can be confirmed."
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
          <Field label="Notes" htmlFor="notes">
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
            hint="For the team only."
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
            href={bookingId ? `/bookings/${bookingId}` : "/bookings"}
            className={buttonClasses("ghost")}
          >
            Cancel
          </Link>
          <SubmitButton pendingLabel="Saving…">
            {mode === "create" ? "Save booking" : "Save changes"}
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
      {/* Parallel arrays: one entry per field per row, so the indexes
          line up on the server even after a row is removed. */}
      <input type="hidden" name="line_type" value={row.line_type} />
      <input type="hidden" name="line_ref" value={row.ref} />
      <input type="hidden" name="line_summary" value={row.component_summary} />

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
          required
        />
      </Field>

      {row.component_summary && (
        <p className="text-xs text-ink-500">
          Reserves: {row.component_summary}
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
