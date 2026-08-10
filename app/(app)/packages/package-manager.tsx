"use client";

import { useActionState, useState } from "react";

import {
  createPackageAction,
  setPackageActiveAction,
  updatePackageAction,
  type CatalogState,
} from "@/lib/catalog/actions";
import {
  COMPONENT_KIND_LABELS,
  COMPONENT_KINDS,
  componentSummary,
  componentsSubtotal,
  OCCASION_LABELS,
  OCCASIONS,
  packageSavings,
} from "@/lib/catalog/packages";
import { centavosToDecimalString, formatPeso } from "@/lib/money";
import type { ComponentKind } from "@/lib/supabase/database.types";
import {
  Badge,
  Banner,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import type { ComponentOption, PackageWithComponents } from "./page";

type ComponentRow = {
  /** Stable key for React; not submitted. */
  key: string;
  catalog_item_id: string;
  quantity: string;
  kind: ComponentKind;
  consumes_stock: boolean;
};

let rowCounter = 0;
function newRow(defaults: Partial<ComponentRow> = {}): ComponentRow {
  rowCounter += 1;
  return {
    key: `row-${rowCounter}`,
    catalog_item_id: "",
    quantity: "1",
    kind: "other",
    consumes_stock: false,
    ...defaults,
  };
}

/**
 * The bill of components (Spec 4.2).
 *
 * Rows post as parallel arrays. `consumes_stock` rides a hidden input
 * rather than the checkbox itself, because an unchecked checkbox posts
 * nothing and would slide every later row's flag up by one.
 */
function ComponentEditor({
  options,
  rows,
  setRows,
}: {
  options: ComponentOption[];
  rows: ComponentRow[];
  setRows: (rows: ComponentRow[]) => void;
}) {
  const priced = rows
    .map((row) => {
      const option = options.find((item) => item.id === row.catalog_item_id);
      if (!option) return null;
      const quantity = /^\d+$/.test(row.quantity)
        ? Number.parseInt(row.quantity, 10)
        : 0;
      return {
        quantity,
        unit_centavos: row.consumes_stock
          ? option.sale_price_centavos
          : option.rental_price_centavos,
      };
    })
    .filter((entry): entry is { quantity: number; unit_centavos: number } =>
      Boolean(entry),
    );

  const subtotal = componentsSubtotal(priced);

  function update(index: number, patch: Partial<ComponentRow>) {
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <fieldset className="space-y-3 rounded-lg border border-ink-200 p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
        Bill of components
      </legend>

      {rows.map((row, index) => {
        const option = options.find((item) => item.id === row.catalog_item_id);

        return (
          <div
            key={row.key}
            className="grid gap-2 rounded-lg bg-ink-50/60 p-2.5 sm:grid-cols-[1fr_5rem_10rem_auto] sm:items-end"
          >
            <div>
              <label
                htmlFor={`${row.key}-item`}
                className="block text-xs font-medium text-ink-600"
              >
                Item
              </label>
              <Select
                id={`${row.key}-item`}
                name="component_item"
                value={row.catalog_item_id}
                onChange={(event) => {
                  const picked = options.find(
                    (item) => item.id === event.target.value,
                  );
                  update(index, {
                    catalog_item_id: event.target.value,
                    // A sale-only item is used up on the setup; anything
                    // rentable comes back and is reserved instead.
                    consumes_stock: picked
                      ? picked.is_sale && !picked.is_rental
                      : false,
                  });
                }}
              >
                <option value="">Choose an item…</option>
                {options.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label
                htmlFor={`${row.key}-qty`}
                className="block text-xs font-medium text-ink-600"
              >
                Qty
              </label>
              <TextInput
                id={`${row.key}-qty`}
                name="component_quantity"
                inputMode="numeric"
                value={row.quantity}
                onChange={(event) =>
                  update(index, { quantity: event.target.value })
                }
              />
            </div>

            <div>
              <label
                htmlFor={`${row.key}-kind`}
                className="block text-xs font-medium text-ink-600"
              >
                Role
              </label>
              <Select
                id={`${row.key}-kind`}
                name="component_kind"
                value={row.kind}
                onChange={(event) =>
                  update(index, { kind: event.target.value as ComponentKind })
                }
              >
                {COMPONENT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {COMPONENT_KIND_LABELS[kind]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="hidden"
                name="component_consumes"
                value={String(row.consumes_stock)}
              />
              <label className="flex items-center gap-1.5 text-xs text-ink-600">
                <input
                  type="checkbox"
                  checked={row.consumes_stock}
                  onChange={(event) =>
                    update(index, { consumes_stock: event.target.checked })
                  }
                  className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600"
                />
                Used up
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
                aria-label="Remove component"
              >
                Remove
              </Button>
            </div>

            {option && (
              <p className="tabular text-xs text-ink-500 sm:col-span-4">
                {row.consumes_stock
                  ? `${formatPeso(option.sale_price_centavos)} each — decrements stock on confirmation`
                  : `${formatPeso(option.rental_price_centavos)} each — reserved for the event dates`}
              </p>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setRows([...rows, newRow()])}
        >
          + Add component
        </Button>
        <p className="tabular text-sm text-ink-600">
          Components separately:{" "}
          <span className="font-semibold text-ink-900">
            {formatPeso(subtotal)}
          </span>
        </p>
      </div>
    </fieldset>
  );
}

function PackageFields({
  idPrefix,
  pkg,
  options,
  rows,
  setRows,
}: {
  idPrefix: string;
  pkg?: PackageWithComponents;
  options: ComponentOption[];
  rows: ComponentRow[];
  setRows: (rows: ComponentRow[]) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Package name" htmlFor={`${idPrefix}-name`} required>
          <TextInput
            id={`${idPrefix}-name`}
            name="name"
            defaultValue={pkg?.name ?? ""}
            placeholder="Birthday Arch Package"
            required
          />
        </Field>

        <Field label="Package price" htmlFor={`${idPrefix}-price`} required>
          <TextInput
            id={`${idPrefix}-price`}
            name="package_price"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={
              pkg ? centavosToDecimalString(pkg.package_price_centavos) : ""
            }
          />
        </Field>
      </div>

      <Field label="Description" htmlFor={`${idPrefix}-description`}>
        <TextArea
          id={`${idPrefix}-description`}
          name="description"
          rows={2}
          defaultValue={pkg?.description ?? ""}
        />
      </Field>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink-700">
          Occasions
        </legend>
        <div className="flex flex-wrap gap-2">
          {OCCASIONS.map((occasion) => (
            <label
              key={occasion}
              className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-ink-50/60 px-2.5 py-1.5 text-sm text-ink-700"
            >
              <input
                type="checkbox"
                name="occasion"
                value={occasion}
                defaultChecked={pkg?.occasion_tags.includes(occasion)}
                className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600"
              />
              {OCCASION_LABELS[occasion]}
            </label>
          ))}
        </div>
      </fieldset>

      <ComponentEditor options={options} rows={rows} setRows={setRows} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Setup time (minutes)"
          htmlFor={`${idPrefix}-setup`}
          hint="Blocks the styling crew's slot on the calendar."
        >
          <TextInput
            id={`${idPrefix}-setup`}
            name="setup_minutes"
            inputMode="numeric"
            defaultValue={String(pkg?.setup_minutes ?? 60)}
          />
        </Field>

        <Field label="Teardown notes" htmlFor={`${idPrefix}-teardown`}>
          <TextInput
            id={`${idPrefix}-teardown`}
            name="teardown_notes"
            defaultValue={pkg?.teardown_notes ?? ""}
            placeholder="Pop balloons on site, roll cloth"
          />
        </Field>
      </div>

      <Field
        label="Photo"
        htmlFor={`${idPrefix}-photo`}
        hint="Optional. JPG, PNG, or WebP up to 5 MB."
      >
        <input
          id={`${idPrefix}-photo`}
          name="photo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="block w-full text-sm text-ink-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700"
        />
      </Field>
    </div>
  );
}

// ── Create ────────────────────────────────────────────────────
export function CreatePackagePanel({
  options,
}: {
  options: ComponentOption[];
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ComponentRow[]>([newRow()]);
  const [state, formAction] = useActionState<CatalogState, FormData>(
    createPackageAction,
    {},
  );

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <Button type="button" onClick={() => setOpen(true)}>
          + Add backdrop package
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
        <CardHeader
          title="New backdrop package"
          description="List everything the setup needs — that is what gets reserved and consumed."
        />
        <CardBody className="space-y-4">
          {state.error && <Banner tone="error">{state.error}</Banner>}
          {state.success && <Banner tone="success">{state.success}</Banner>}

          {options.length === 0 && (
            <Banner tone="warning">
              Add catalog items first — a package is built from them.
            </Banner>
          )}

          <PackageFields
            idPrefix="new-package"
            options={options}
            rows={rows}
            setRows={setRows}
          />
        </CardBody>
        <CardFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          <SubmitButton pendingLabel="Saving…">Save package</SubmitButton>
        </CardFooter>
      </form>
    </Card>
  );
}

// ── Row ───────────────────────────────────────────────────────
export function PackageRow({
  pkg,
  options,
  canManage,
}: {
  pkg: PackageWithComponents;
  options: ComponentOption[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);

  const subtotal = componentsSubtotal(pkg.components);
  const savings = packageSavings(pkg.package_price_centavos, subtotal);

  return (
    <li className="border-b border-ink-200 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-ink-900">{pkg.name}</p>
            {!pkg.is_active && <Badge tone="danger">Archived</Badge>}
            {pkg.occasion_tags.map((tag) => (
              <Badge key={tag} tone="brand">
                {OCCASION_LABELS[tag as keyof typeof OCCASION_LABELS] ?? tag}
              </Badge>
            ))}
          </div>

          <p className="tabular mt-1 text-sm">
            <span className="font-semibold text-ink-900">
              {formatPeso(pkg.package_price_centavos)}
            </span>
            <span className="text-ink-500">
              {" "}
              · {pkg.setup_minutes} min setup
              {savings > 0 && ` · saves ${formatPeso(savings)} vs components`}
            </span>
          </p>

          {pkg.components.length > 0 && (
            <p className="mt-1 text-xs text-ink-600">
              {componentSummary(pkg.components, 6)}
            </p>
          )}

          {pkg.description && (
            <p className="mt-1 text-sm text-ink-600">{pkg.description}</p>
          )}
        </div>

        {canManage && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setEditing((value) => !value)}
              aria-expanded={editing}
            >
              {editing ? "Cancel" : "Edit"}
            </Button>
            <ArchiveButton packageId={pkg.id} isActive={pkg.is_active} />
          </div>
        )}
      </div>

      {editing && (
        <div className="border-t border-ink-200 bg-ink-50/50 px-4 py-4 sm:px-6">
          <EditPackageForm
            pkg={pkg}
            options={options}
            onDone={() => setEditing(false)}
          />
        </div>
      )}
    </li>
  );
}

function EditPackageForm({
  pkg,
  options,
  onDone,
}: {
  pkg: PackageWithComponents;
  options: ComponentOption[];
  onDone: () => void;
}) {
  const [rows, setRows] = useState<ComponentRow[]>(() =>
    pkg.components.length > 0
      ? pkg.components.map((component) =>
          newRow({
            catalog_item_id: component.catalog_item_id,
            quantity: String(component.quantity),
            kind: component.kind,
            consumes_stock: component.consumes_stock,
          }),
        )
      : [newRow()],
  );

  const [state, formAction] = useActionState<CatalogState, FormData>(
    updatePackageAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="package_id" value={pkg.id} />

      {state.error && <Banner tone="error">{state.error}</Banner>}
      {state.success && <Banner tone="success">{state.success}</Banner>}

      <PackageFields
        idPrefix={`package-${pkg.id}`}
        pkg={pkg}
        options={options}
        rows={rows}
        setRows={setRows}
      />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Done
        </Button>
        <SubmitButton size="sm" pendingLabel="Saving…">
          Save
        </SubmitButton>
      </div>
    </form>
  );
}

function ArchiveButton({
  packageId,
  isActive,
}: {
  packageId: string;
  isActive: boolean;
}) {
  const [state, formAction] = useActionState<CatalogState, FormData>(
    setPackageActiveAction,
    {},
  );

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="package_id" value={packageId} />
        <input type="hidden" name="activate" value={String(!isActive)} />
        <SubmitButton
          variant={isActive ? "danger" : "secondary"}
          size="sm"
          pendingLabel="Saving…"
        >
          {isActive ? "Archive" : "Restore"}
        </SubmitButton>
      </form>
      {state.error && (
        <p className="mt-1 max-w-64 text-xs font-medium text-danger-600">
          {state.error}
        </p>
      )}
    </div>
  );
}
