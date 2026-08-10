"use client";

import { useActionState, useState, type ReactNode } from "react";

import {
  savePaymentAccountsAction,
  updateAgreementClausesAction,
  updateBusinessProfileAction,
  updateDefaultsAction,
  updateDeliverySettingsAction,
  updateExpenseCategoriesAction,
  type SettingsState,
} from "@/lib/settings/actions";
import {
  needsBankName,
  PAYMENT_CHANNEL_LABELS,
  PAYMENT_CHANNELS,
} from "@/lib/settings/payment-accounts";
import type {
  AgreementClause,
  BusinessSettings,
  DeliveryFeeArea,
  PaymentAccount,
  PaymentChannel,
} from "@/lib/supabase/database.types";
import { centavosToDecimalString, formatPeso } from "@/lib/money";
import { Banner, Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Field, Select, TextArea, TextInput, inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";

type Action = (
  state: SettingsState,
  formData: FormData,
) => Promise<SettingsState>;

/**
 * Card + form + result banner, shared by every settings section.
 *
 * No `encType`: React sets the encoding itself for a function action and
 * switches to multipart automatically once the FormData carries a file,
 * so the logo upload works without one. Passing it is an error.
 */
function SectionForm({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action: Action;
  children: ReactNode;
}) {
  const [state, formAction] = useActionState<SettingsState, FormData>(
    action,
    {},
  );

  return (
    <Card>
      <form action={formAction}>
        <CardHeader title={title} description={description} />
        <CardBody className="space-y-4">
          {state.error && <Banner tone="error">{state.error}</Banner>}
          {state.success && <Banner tone="success">{state.success}</Banner>}
          {children}
        </CardBody>
        <CardFooter>
          <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
        </CardFooter>
      </form>
    </Card>
  );
}

function RemoveRowButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-danger-50 hover:text-danger-600"
      aria-label="Remove row"
    >
      <svg
        className="size-5"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.8}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

// ── Business profile ──────────────────────────────────────────
export function BusinessProfileForm({
  settings,
}: {
  settings: BusinessSettings;
}) {
  return (
    <SectionForm
      title="Business profile"
      description="Appears on every quotation, rental agreement, and report."
      action={updateBusinessProfileAction}
    >
      <Field label="Business name" htmlFor="business_name" required>
        <TextInput
          id="business_name"
          name="business_name"
          defaultValue={settings.business_name}
          required
        />
      </Field>

      <Field label="Address" htmlFor="address">
        <TextArea
          id="address"
          name="address"
          rows={2}
          defaultValue={settings.address}
          placeholder="Blk 1 Lot 2, Deca Homes Meycauayan, Bulacan"
        />
      </Field>

      <Field
        label="Contact numbers"
        htmlFor="contact_numbers"
        hint="Separate multiple numbers with commas."
      >
        <TextInput
          id="contact_numbers"
          name="contact_numbers"
          defaultValue={settings.contact_numbers.join(", ")}
          placeholder="0917 123 4567, 0918 765 4321"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" htmlFor="email">
          <TextInput
            id="email"
            name="email"
            type="email"
            defaultValue={settings.email ?? ""}
          />
        </Field>

        <Field label="Facebook page" htmlFor="facebook_page">
          <TextInput
            id="facebook_page"
            name="facebook_page"
            defaultValue={settings.facebook_page ?? ""}
            placeholder="facebook.com/royzepartyneeds"
          />
        </Field>
      </div>

      <Field
        label="TIN"
        htmlFor="tin"
        hint="Shown on quotations and rental agreements."
      >
        <TextInput id="tin" name="tin" defaultValue={settings.tin ?? ""} />
      </Field>

      <Field
        label="Logo"
        htmlFor="logo"
        hint="PNG, JPG, WEBP, or SVG. Max 2 MB. Used on-screen and in PDFs."
      >
        <div className="flex items-center gap-3">
          {settings.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element -- user upload
            <img
              src={settings.logo_url}
              alt="Current logo"
              className="size-14 rounded-lg border border-ink-200 object-contain p-1"
            />
          )}
          <input
            id="logo"
            name="logo"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="block w-full text-sm text-ink-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
          />
        </div>
      </Field>
    </SectionForm>
  );
}

// ── Payment accounts ──────────────────────────────────────────
type AccountRow = {
  /** Stable React key; not submitted. */
  key: string;
  /** Empty for a row that has never been saved. */
  id: string;
  channel: PaymentChannel;
  bank_name: string;
  account_name: string;
  account_number: string;
  is_active: boolean;
};

let accountRowCounter = 0;
function newAccountRow(defaults: Partial<AccountRow> = {}): AccountRow {
  accountRowCounter += 1;
  return {
    key: `account-${accountRowCounter}`,
    id: "",
    channel: "gcash",
    bank_name: "",
    account_name: "",
    account_number: "",
    is_active: true,
    ...defaults,
  };
}

/**
 * Any number of accounts per channel (Spec 4.12).
 *
 * `is_active` rides a hidden input rather than the checkbox itself: an
 * unchecked checkbox posts nothing, which would slide every later row's
 * flag up by one when the arrays are zipped back together.
 */
export function PaymentAccountsForm({
  accounts,
  cashNote,
}: {
  accounts: PaymentAccount[];
  cashNote: string;
}) {
  const [rows, setRows] = useState<AccountRow[]>(() =>
    accounts.length > 0
      ? accounts.map((account) =>
          newAccountRow({
            id: account.id,
            channel: account.channel,
            bank_name: account.bank_name,
            account_name: account.account_name,
            account_number: account.account_number,
            is_active: account.is_active,
          }),
        )
      : [newAccountRow()],
  );

  function update(index: number, patch: Partial<AccountRow>) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  const activeCount = rows.filter(
    (row) => row.is_active && row.account_number.trim(),
  ).length;

  return (
    <SectionForm
      title="Payment channels"
      description="Every active account is printed on quotations and rental agreements, so customers know where to send payment."
      action={savePaymentAccountsAction}
    >
      <div>
        <label
          htmlFor="cash_payment_note"
          className="block text-sm font-medium text-ink-700"
        >
          Cash instructions
        </label>
        <p className="mb-1.5 text-xs text-ink-500">
          What the CASH box says on quotations and agreements. Leave it blank
          if you do not take cash at all — the box is then left off entirely.
        </p>
        <TextInput
          id="cash_payment_note"
          name="cash_payment_note"
          defaultValue={cashNote}
          placeholder="e.g. At the shop only — we do not accept cash on delivery."
        />
      </div>

      <div className="space-y-3">
        {rows.map((row, index) => (
          <fieldset
            key={row.key}
            className="space-y-3 rounded-xl border border-ink-200 bg-ink-50/50 p-3"
          >
            <legend className="sr-only">Payment account {index + 1}</legend>

            <input type="hidden" name="account_id" value={row.id} />
            <input
              type="hidden"
              name="account_active"
              value={String(row.is_active)}
            />

            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-36 flex-1">
                <label
                  htmlFor={`${row.key}-channel`}
                  className="block text-xs font-medium text-ink-600"
                >
                  Channel
                </label>
                <Select
                  id={`${row.key}-channel`}
                  name="account_channel"
                  value={row.channel}
                  onChange={(event) =>
                    update(index, {
                      channel: event.target.value as PaymentChannel,
                    })
                  }
                >
                  {PAYMENT_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {PAYMENT_CHANNEL_LABELS[channel]}
                    </option>
                  ))}
                </Select>
              </div>

              <label className="flex min-h-11 items-center gap-1.5 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={row.is_active}
                  onChange={(event) =>
                    update(index, { is_active: event.target.checked })
                  }
                  className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600"
                />
                Active
              </label>

              <RemoveRowButton
                onClick={() =>
                  setRows((current) => current.filter((_, i) => i !== index))
                }
              />
            </div>

            {/* Bank transfers need a bank; e-wallets do not. The input
                stays mounted so the posted arrays keep their alignment. */}
            <div className={needsBankName(row.channel) ? "" : "hidden"}>
              <label
                htmlFor={`${row.key}-bank`}
                className="block text-xs font-medium text-ink-600"
              >
                Bank name
              </label>
              <TextInput
                id={`${row.key}-bank`}
                name="account_bank_name"
                value={row.bank_name}
                onChange={(event) =>
                  update(index, { bank_name: event.target.value })
                }
                placeholder="BPI, BDO, Metrobank…"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor={`${row.key}-name`}
                  className="block text-xs font-medium text-ink-600"
                >
                  Account name
                </label>
                <TextInput
                  id={`${row.key}-name`}
                  name="account_name"
                  value={row.account_name}
                  onChange={(event) =>
                    update(index, { account_name: event.target.value })
                  }
                  placeholder="Royze Party Needs Rental"
                />
              </div>

              <div>
                <label
                  htmlFor={`${row.key}-number`}
                  className="block text-xs font-medium text-ink-600"
                >
                  {needsBankName(row.channel) ? "Account number" : "Mobile number"}
                </label>
                <TextInput
                  id={`${row.key}-number`}
                  name="account_number"
                  inputMode={needsBankName(row.channel) ? "numeric" : "tel"}
                  value={row.account_number}
                  onChange={(event) =>
                    update(index, { account_number: event.target.value })
                  }
                  placeholder={
                    needsBankName(row.channel) ? "1234-5678-90" : "0917 123 4567"
                  }
                />
              </div>
            </div>

            {!row.is_active && (
              <p className="text-xs text-ink-500">
                Kept on file but left off quotations and agreements.
              </p>
            )}
          </fieldset>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setRows((current) => [...current, newAccountRow()])}
        >
          + Add account
        </Button>
        <p className="text-sm text-ink-600">
          {activeCount} active{" "}
          {activeCount === 1 ? "account will" : "accounts will"} print on
          documents.
        </p>
      </div>
    </SectionForm>
  );
}

// ── Defaults ──────────────────────────────────────────────────
export function DefaultsForm({ settings }: { settings: BusinessSettings }) {
  return (
    <SectionForm
      title="Booking defaults"
      description="Applied to new quotations and bookings; both stay editable per record."
      action={updateDefaultsAction}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Downpayment required"
          htmlFor="downpayment_percent"
          required
          hint="A booking cannot be Confirmed until verified payments reach this share of the total."
        >
          <div className="flex items-center gap-2">
            <TextInput
              id="downpayment_percent"
              name="downpayment_percent"
              type="number"
              min={0}
              max={100}
              step="0.01"
              inputMode="decimal"
              defaultValue={settings.downpayment_percent}
              required
            />
            <span className="text-sm font-medium text-ink-600">%</span>
          </div>
        </Field>

        <Field
          label="Quotation validity"
          htmlFor="quotation_validity_days"
          required
          hint="Days before a sent quotation expires."
        >
          <div className="flex items-center gap-2">
            <TextInput
              id="quotation_validity_days"
              name="quotation_validity_days"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              defaultValue={settings.quotation_validity_days}
              required
            />
            <span className="text-sm font-medium text-ink-600">days</span>
          </div>
        </Field>
      </div>
    </SectionForm>
  );
}

// ── Delivery & pickup ─────────────────────────────────────────
export function DeliverySettingsForm({
  settings,
}: {
  settings: BusinessSettings;
}) {
  const [rows, setRows] = useState<DeliveryFeeArea[]>(
    settings.delivery_fee_table.length > 0
      ? settings.delivery_fee_table
      : [{ area: "", fee_centavos: 0 }],
  );

  return (
    <SectionForm
      title="Delivery & pickup fees"
      description="Delivery and pickup are free inside your service area; anywhere else is charged."
      action={updateDeliverySettingsAction}
    >
      <Field
        label="Free delivery area"
        htmlFor="free_delivery_area"
        required
        hint='Bookings marked inside this area lock the fee to ₱0 and print "FREE Delivery & Pickup".'
      >
        <TextInput
          id="free_delivery_area"
          name="free_delivery_area"
          defaultValue={settings.free_delivery_area}
          required
        />
      </Field>

      <div className="space-y-2">
        <p className="text-sm font-medium text-ink-700">
          Suggested fees outside the free area
        </p>
        <p className="text-xs text-ink-500">
          Optional. Used to pre-fill the delivery fee; staff can always
          override it on the booking.
        </p>

        <div className="space-y-2 pt-1">
          {rows.map((row, index) => (
            <div key={index} className="flex items-start gap-2">
              <input
                name="fee_area"
                defaultValue={row.area}
                placeholder="Area or barangay"
                aria-label={`Area ${index + 1}`}
                className={`${inputClasses} flex-1`}
              />
              <div className="relative w-32 shrink-0 sm:w-40">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500">
                  ₱
                </span>
                <input
                  name="fee_amount"
                  defaultValue={
                    row.fee_centavos
                      ? centavosToDecimalString(row.fee_centavos)
                      : ""
                  }
                  placeholder="0.00"
                  inputMode="decimal"
                  aria-label={`Fee for area ${index + 1}`}
                  className={`${inputClasses} pl-7`}
                />
              </div>
              <RemoveRowButton
                onClick={() =>
                  setRows((current) => current.filter((_, i) => i !== index))
                }
              />
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            setRows((current) => [...current, { area: "", fee_centavos: 0 }])
          }
        >
          + Add area
        </Button>
      </div>
    </SectionForm>
  );
}

// ── Agreement template ────────────────────────────────────────
export function AgreementClausesForm({
  settings,
}: {
  settings: BusinessSettings;
}) {
  const [clauses, setClauses] = useState<AgreementClause[]>(
    settings.agreement_clauses.length > 0
      ? settings.agreement_clauses
      : [{ heading: "", body: "" }],
  );

  return (
    <SectionForm
      title="Rental agreement template"
      description="These clauses print on every rental agreement. Edit the wording anytime."
      action={updateAgreementClausesAction}
    >
      <div className="space-y-3">
        {clauses.map((clause, index) => (
          <div
            key={index}
            className="rounded-xl border border-ink-200 bg-ink-50/50 p-3"
          >
            <div className="flex items-start gap-2">
              <input
                name="clause_heading"
                defaultValue={clause.heading}
                placeholder="Clause heading"
                aria-label={`Clause ${index + 1} heading`}
                className={`${inputClasses} flex-1 font-semibold`}
              />
              <RemoveRowButton
                onClick={() =>
                  setClauses((current) =>
                    current.filter((_, i) => i !== index),
                  )
                }
              />
            </div>
            <textarea
              name="clause_body"
              defaultValue={clause.body}
              rows={3}
              placeholder="Clause text…"
              aria-label={`Clause ${index + 1} body`}
              className={`${inputClasses} mt-2`}
            />
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() =>
          setClauses((current) => [...current, { heading: "", body: "" }])
        }
      >
        + Add clause
      </Button>
    </SectionForm>
  );
}

// ── Expense categories ────────────────────────────────────────
export function ExpenseCategoriesForm({
  settings,
}: {
  settings: BusinessSettings;
}) {
  const [categories, setCategories] = useState<string[]>(
    settings.expense_categories.length > 0 ? settings.expense_categories : [""],
  );

  return (
    <SectionForm
      title="Expense categories"
      description="Used when recording expenses and grouping the expense report for BIR filing."
      action={updateExpenseCategoriesAction}
    >
      <div className="space-y-2">
        {categories.map((category, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              name="category"
              defaultValue={category}
              placeholder="Category name"
              aria-label={`Category ${index + 1}`}
              className={`${inputClasses} flex-1`}
            />
            <RemoveRowButton
              onClick={() =>
                setCategories((current) =>
                  current.filter((_, i) => i !== index),
                )
              }
            />
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setCategories((current) => [...current, ""])}
      >
        + Add category
      </Button>
    </SectionForm>
  );
}

/** Read-only preview so the owner can sanity-check the fee table. */
export function DeliveryFeePreview({ rows }: { rows: DeliveryFeeArea[] }) {
  if (rows.length === 0) return null;

  return (
    <ul className="mt-2 space-y-1 text-sm text-ink-600">
      {rows.map((row) => (
        <li key={row.area} className="flex justify-between gap-4">
          <span>{row.area}</span>
          <span className="tabular font-medium text-ink-800">
            {formatPeso(row.fee_centavos)}
          </span>
        </li>
      ))}
    </ul>
  );
}
