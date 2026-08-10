"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import {
  createCustomerAction,
  setCustomerActiveAction,
  updateCustomerAction,
  type CustomerState,
} from "@/lib/customers/actions";
import type { Customer } from "@/lib/supabase/database.types";
import {
  Banner,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";

/**
 * Possible duplicates found on the number (Spec 4.1).
 *
 * Shown as links, never as a block: staff decide whether this really is
 * the same person. Saving again with the acknowledgement goes through.
 */
function DuplicateNotice({
  duplicates,
}: {
  duplicates: NonNullable<CustomerState["duplicates"]>;
}) {
  return (
    <div className="rounded-lg border border-warning-100 bg-warning-50 p-3">
      <p className="text-sm font-semibold text-warning-700">
        Already on that number
      </p>
      <ul className="mt-1.5 space-y-1">
        {duplicates.map((duplicate) => (
          <li key={duplicate.id}>
            <Link
              href={`/customers/${duplicate.id}`}
              className="text-sm font-medium text-brand-700 underline underline-offset-2"
            >
              {duplicate.name}
            </Link>
            <span className="tabular ml-2 text-xs text-ink-600">
              {duplicate.phone}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-warning-700">
        Open the existing record, or press Save again to add this one anyway.
      </p>
    </div>
  );
}

function CustomerFields({
  idPrefix,
  customer,
}: {
  idPrefix: string;
  customer?: Customer;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${idPrefix}-name`} required>
          <TextInput
            id={`${idPrefix}-name`}
            name="name"
            defaultValue={customer?.name ?? ""}
            required
          />
        </Field>

        <Field label="Contact number" htmlFor={`${idPrefix}-phone`} required>
          <TextInput
            id={`${idPrefix}-phone`}
            name="phone"
            inputMode="tel"
            placeholder="0917 123 4567"
            defaultValue={customer?.phone ?? ""}
            required
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Other number" htmlFor={`${idPrefix}-alt-phone`}>
          <TextInput
            id={`${idPrefix}-alt-phone`}
            name="alt_phone"
            inputMode="tel"
            defaultValue={customer?.alt_phone ?? ""}
          />
        </Field>

        <Field label="Email" htmlFor={`${idPrefix}-email`}>
          <TextInput
            id={`${idPrefix}-email`}
            name="email"
            type="email"
            autoCapitalize="none"
            defaultValue={customer?.email ?? ""}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Facebook name"
          htmlFor={`${idPrefix}-fb-name`}
          hint="How the enquiry came in on Messenger."
        >
          <TextInput
            id={`${idPrefix}-fb-name`}
            name="facebook_name"
            defaultValue={customer?.facebook_name ?? ""}
          />
        </Field>

        <Field label="Facebook profile link" htmlFor={`${idPrefix}-fb-url`}>
          <TextInput
            id={`${idPrefix}-fb-url`}
            name="facebook_url"
            inputMode="url"
            defaultValue={customer?.facebook_url ?? ""}
          />
        </Field>
      </div>

      <Field label="Address" htmlFor={`${idPrefix}-address`}>
        <TextArea
          id={`${idPrefix}-address`}
          name="address"
          rows={2}
          defaultValue={customer?.address ?? ""}
        />
      </Field>

      <Field
        label="Landmark"
        htmlFor={`${idPrefix}-landmark`}
        hint="What the driver looks for — “beside the barangay hall”."
      >
        <TextInput
          id={`${idPrefix}-landmark`}
          name="landmark"
          defaultValue={customer?.landmark ?? ""}
        />
      </Field>

      <Field label="Notes" htmlFor={`${idPrefix}-notes`}>
        <TextArea
          id={`${idPrefix}-notes`}
          name="notes"
          rows={2}
          defaultValue={customer?.notes ?? ""}
        />
      </Field>
    </div>
  );
}

// ── Create ────────────────────────────────────────────────────
export function CreateCustomerPanel() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<CustomerState, FormData>(
    createCustomerAction,
    {},
  );

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <Button type="button" onClick={() => setOpen(true)}>
          + Add customer
        </Button>
        {state.success && (
          <span className="text-sm font-medium text-success-700">
            {state.success}
          </span>
        )}
      </div>
    );
  }

  return (
    <Card>
      <form action={formAction}>
        {/* Present once duplicates have been shown, so the next submit
            is read as "yes, add them anyway". */}
        {state.duplicates && state.duplicates.length > 0 && (
          <input type="hidden" name="duplicate_ack" value="true" />
        )}

        <CardHeader
          title="New customer"
          description="A contact number is required — it is how the driver reaches them on the day."
        />
        <CardBody className="space-y-4">
          {state.error && <Banner tone="error">{state.error}</Banner>}
          {state.success && <Banner tone="success">{state.success}</Banner>}
          {state.duplicates && state.duplicates.length > 0 && (
            <DuplicateNotice duplicates={state.duplicates} />
          )}

          <CustomerFields idPrefix="new-customer" />
        </CardBody>
        <CardFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          <SubmitButton pendingLabel="Saving…">Save customer</SubmitButton>
        </CardFooter>
      </form>
    </Card>
  );
}

// ── Edit (customer profile page) ──────────────────────────────
export function EditCustomerPanel({ customer }: { customer: Customer }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<CustomerState, FormData>(
    updateCustomerAction,
    {},
  );

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          Edit details
        </Button>
        <ArchiveCustomerButton
          customerId={customer.id}
          isActive={customer.is_active}
        />
        {state.success && (
          <span className="text-sm font-medium text-success-700">
            {state.success}
          </span>
        )}
      </div>
    );
  }

  return (
    <Card>
      <form action={formAction}>
        <input type="hidden" name="customer_id" value={customer.id} />
        <CardHeader title="Edit customer" />
        <CardBody className="space-y-4">
          {state.error && <Banner tone="error">{state.error}</Banner>}
          {state.success && <Banner tone="success">{state.success}</Banner>}
          <CustomerFields
            idPrefix={`customer-${customer.id}`}
            customer={customer}
          />
        </CardBody>
        <CardFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
        </CardFooter>
      </form>
    </Card>
  );
}

function ArchiveCustomerButton({
  customerId,
  isActive,
}: {
  customerId: string;
  isActive: boolean;
}) {
  const [state, formAction] = useActionState<CustomerState, FormData>(
    setCustomerActiveAction,
    {},
  );

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="customer_id" value={customerId} />
        <input type="hidden" name="activate" value={String(!isActive)} />
        <SubmitButton
          variant={isActive ? "danger" : "secondary"}
          pendingLabel="Saving…"
        >
          {isActive ? "Archive" : "Restore"}
        </SubmitButton>
      </form>
      {state.error && (
        <p className="mt-1 text-xs font-medium text-danger-600">{state.error}</p>
      )}
    </div>
  );
}
