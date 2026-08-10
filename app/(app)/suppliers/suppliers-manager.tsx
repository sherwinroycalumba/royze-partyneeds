"use client";

import { useActionState, useState } from "react";

import {
  createSupplierAction,
  setSupplierActiveAction,
  updateSupplierAction,
  type SupplierState,
} from "@/lib/suppliers/actions";
import type { Supplier } from "@/lib/supabase/database.types";
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

function SupplierFields({
  idPrefix,
  supplier,
}: {
  idPrefix: string;
  supplier?: Supplier;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Supplier name" htmlFor={`${idPrefix}-name`} required>
          <TextInput
            id={`${idPrefix}-name`}
            name="name"
            defaultValue={supplier?.name ?? ""}
            required
          />
        </Field>

        <Field label="Contact person" htmlFor={`${idPrefix}-contact`}>
          <TextInput
            id={`${idPrefix}-contact`}
            name="contact_person"
            defaultValue={supplier?.contact_person ?? ""}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact number" htmlFor={`${idPrefix}-phone`}>
          <TextInput
            id={`${idPrefix}-phone`}
            name="phone"
            inputMode="tel"
            defaultValue={supplier?.phone ?? ""}
          />
        </Field>

        <Field label="Email" htmlFor={`${idPrefix}-email`}>
          <TextInput
            id={`${idPrefix}-email`}
            name="email"
            type="email"
            autoCapitalize="none"
            defaultValue={supplier?.email ?? ""}
          />
        </Field>
      </div>

      <Field
        label="What they supply"
        htmlFor={`${idPrefix}-supplies`}
        hint="Balloons, foil balloons, party poppers…"
      >
        <TextInput
          id={`${idPrefix}-supplies`}
          name="supplies"
          defaultValue={supplier?.supplies ?? ""}
        />
      </Field>

      <Field label="Address" htmlFor={`${idPrefix}-address`}>
        <TextArea
          id={`${idPrefix}-address`}
          name="address"
          rows={2}
          defaultValue={supplier?.address ?? ""}
        />
      </Field>

      <Field label="Notes" htmlFor={`${idPrefix}-notes`}>
        <TextArea
          id={`${idPrefix}-notes`}
          name="notes"
          rows={2}
          defaultValue={supplier?.notes ?? ""}
        />
      </Field>
    </div>
  );
}

export function CreateSupplierPanel() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<SupplierState, FormData>(
    createSupplierAction,
    {},
  );

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <Button type="button" onClick={() => setOpen(true)}>
          + Add supplier
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
        <CardHeader title="New supplier" />
        <CardBody className="space-y-4">
          {state.error && <Banner tone="error">{state.error}</Banner>}
          {state.success && <Banner tone="success">{state.success}</Banner>}
          <SupplierFields idPrefix="new-supplier" />
        </CardBody>
        <CardFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          <SubmitButton pendingLabel="Saving…">Save supplier</SubmitButton>
        </CardFooter>
      </form>
    </Card>
  );
}

export function EditSupplierPanel({ supplier }: { supplier: Supplier }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<SupplierState, FormData>(
    updateSupplierAction,
    {},
  );

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          Edit details
        </Button>
        <ArchiveSupplierButton
          supplierId={supplier.id}
          isActive={supplier.is_active}
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
        <input type="hidden" name="supplier_id" value={supplier.id} />
        <CardHeader title="Edit supplier" />
        <CardBody className="space-y-4">
          {state.error && <Banner tone="error">{state.error}</Banner>}
          {state.success && <Banner tone="success">{state.success}</Banner>}
          <SupplierFields
            idPrefix={`supplier-${supplier.id}`}
            supplier={supplier}
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

function ArchiveSupplierButton({
  supplierId,
  isActive,
}: {
  supplierId: string;
  isActive: boolean;
}) {
  const [state, formAction] = useActionState<SupplierState, FormData>(
    setSupplierActiveAction,
    {},
  );

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="supplier_id" value={supplierId} />
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
