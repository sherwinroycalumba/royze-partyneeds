"use client";

import { useActionState, useState } from "react";

import {
  adjustStockAction,
  createCatalogItemAction,
  setCatalogItemActiveAction,
  updateCatalogItemAction,
  type CatalogState,
} from "@/lib/catalog/actions";
import {
  CATEGORY_SUGGESTIONS,
  itemTypeLabel,
  stockStatus,
} from "@/lib/catalog/items";
import { centavosToDecimalString, formatPeso } from "@/lib/money";
import type { CatalogItem } from "@/lib/supabase/database.types";
import {
  Badge,
  Banner,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";

const CATEGORY_LIST_ID = "catalog-categories";

function peso(centavos: number): string {
  return centavosToDecimalString(centavos);
}

/** Checkbox styled as a card — a comfortable tap target on a phone. */
function TypeToggle({
  id,
  name,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex items-start gap-2.5 rounded-lg border p-3 transition-colors ${
        checked
          ? "border-brand-600 bg-brand-50"
          : "border-ink-200 bg-ink-50/60"
      }`}
    >
      <input
        id={id}
        name={name}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600"
      />
      <span>
        <span className="block text-sm font-medium text-ink-800">{label}</span>
        <span className="block text-xs text-ink-500">{hint}</span>
      </span>
    </label>
  );
}

/**
 * The item form, shared by create and edit. `idPrefix` keeps label
 * associations unique when several edit forms are open at once.
 */
function ItemFields({
  idPrefix,
  item,
  canSeeCost,
}: {
  idPrefix: string;
  item?: CatalogItem;
  canSeeCost: boolean;
}) {
  const [isRental, setIsRental] = useState(item?.is_rental ?? true);
  const [isSale, setIsSale] = useState(item?.is_sale ?? false);

  return (
    <div className="space-y-4">
      <datalist id={CATEGORY_LIST_ID}>
        {CATEGORY_SUGGESTIONS.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Item name" htmlFor={`${idPrefix}-name`} required>
          <TextInput
            id={`${idPrefix}-name`}
            name="name"
            defaultValue={item?.name ?? ""}
            required
          />
        </Field>

        <Field
          label="Category"
          htmlFor={`${idPrefix}-category`}
          hint="Pick a suggestion or type your own."
        >
          <TextInput
            id={`${idPrefix}-category`}
            name="category"
            list={CATEGORY_LIST_ID}
            defaultValue={item?.category ?? ""}
          />
        </Field>
      </div>

      <Field label="Description" htmlFor={`${idPrefix}-description`}>
        <TextArea
          id={`${idPrefix}-description`}
          name="description"
          rows={2}
          defaultValue={item?.description ?? ""}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <TypeToggle
          id={`${idPrefix}-is-rental`}
          name="is_rental"
          label="Rental item"
          hint="Rented out per event and returned."
          checked={isRental}
          onChange={setIsRental}
        />
        <TypeToggle
          id={`${idPrefix}-is-sale`}
          name="is_sale"
          label="Sale item"
          hint="Sold outright and decrements stock."
          checked={isSale}
          onChange={setIsSale}
        />
      </div>

      {isRental && (
        <fieldset className="space-y-4 rounded-lg border border-ink-200 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
            Rental
          </legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Rental price" htmlFor={`${idPrefix}-rental-price`} required>
              <TextInput
                id={`${idPrefix}-rental-price`}
                name="rental_price"
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={item ? peso(item.rental_price_centavos) : ""}
              />
            </Field>

            <Field
              label="Replacement value"
              htmlFor={`${idPrefix}-replacement`}
              hint="Charged when damaged or lost."
              required
            >
              <TextInput
                id={`${idPrefix}-replacement`}
                name="replacement_value"
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={item ? peso(item.replacement_value_centavos) : ""}
              />
            </Field>

            <Field label="Quantity owned" htmlFor={`${idPrefix}-owned`} required>
              <TextInput
                id={`${idPrefix}-owned`}
                name="quantity_owned"
                inputMode="numeric"
                defaultValue={item ? String(item.quantity_owned) : "1"}
              />
            </Field>
          </div>
        </fieldset>
      )}

      {isSale && (
        <fieldset className="space-y-4 rounded-lg border border-ink-200 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
            Sale
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Unit price" htmlFor={`${idPrefix}-sale-price`} required>
              <TextInput
                id={`${idPrefix}-sale-price`}
                name="sale_price"
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={item ? peso(item.sale_price_centavos) : ""}
              />
            </Field>

            {canSeeCost && (
              <Field
                label="Cost price"
                htmlFor={`${idPrefix}-cost-price`}
                hint="Owner and bookkeeper only. Used for margin."
              >
                <TextInput
                  id={`${idPrefix}-cost-price`}
                  name="cost_price"
                  inputMode="decimal"
                  placeholder="0.00"
                  defaultValue={item ? peso(item.cost_price_centavos) : ""}
                />
              </Field>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Stock quantity" htmlFor={`${idPrefix}-stock`}>
              <TextInput
                id={`${idPrefix}-stock`}
                name="stock_quantity"
                inputMode="numeric"
                defaultValue={item ? String(item.stock_quantity) : "0"}
              />
            </Field>

            <Field
              label="Low-stock threshold"
              htmlFor={`${idPrefix}-threshold`}
              hint="0 turns the alert off for this item."
            >
              <TextInput
                id={`${idPrefix}-threshold`}
                name="low_stock_threshold"
                inputMode="numeric"
                defaultValue={item ? String(item.low_stock_threshold) : "0"}
              />
            </Field>
          </div>
        </fieldset>
      )}

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
export function CreateItemPanel({ canSeeCost }: { canSeeCost: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<CatalogState, FormData>(
    createCatalogItemAction,
    {},
  );

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <Button type="button" onClick={() => setOpen(true)}>
          + Add catalog item
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
          title="New catalog item"
          description="Tick both types when the same item is rented out and also sold."
        />
        <CardBody className="space-y-4">
          {state.error && <Banner tone="error">{state.error}</Banner>}
          {state.success && <Banner tone="success">{state.success}</Banner>}
          <ItemFields idPrefix="new-item" canSeeCost={canSeeCost} />
        </CardBody>
        <CardFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          <SubmitButton pendingLabel="Saving…">Save item</SubmitButton>
        </CardFooter>
      </form>
    </Card>
  );
}

// ── Row ───────────────────────────────────────────────────────
export function ItemRow({
  item,
  canManage,
  canSeeCost,
}: {
  item: CatalogItem;
  canManage: boolean;
  canSeeCost: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const stock = stockStatus(item);

  return (
    <li className="border-b border-ink-200 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-ink-900">{item.name}</p>
            <Badge tone="brand">{itemTypeLabel(item)}</Badge>
            {!item.is_active && <Badge tone="danger">Archived</Badge>}
            {stock === "out" && <Badge tone="danger">Out of stock</Badge>}
            {stock === "low" && <Badge tone="warning">Low stock</Badge>}
          </div>

          {item.category && (
            <p className="mt-0.5 text-sm text-ink-600">{item.category}</p>
          )}

          <div className="tabular mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
            {item.is_rental && (
              <>
                <span>
                  <span className="font-semibold text-ink-700">
                    {formatPeso(item.rental_price_centavos)}
                  </span>{" "}
                  per event
                </span>
                <span>{item.quantity_owned} owned</span>
                <span>
                  {formatPeso(item.replacement_value_centavos)} replacement
                </span>
              </>
            )}
            {item.is_sale && (
              <>
                <span>
                  <span className="font-semibold text-ink-700">
                    {formatPeso(item.sale_price_centavos)}
                  </span>{" "}
                  each
                </span>
                <span>{item.stock_quantity} in stock</span>
                {canSeeCost && item.cost_price_centavos > 0 && (
                  <span>{formatPeso(item.cost_price_centavos)} cost</span>
                )}
              </>
            )}
          </div>
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
            <ArchiveButton itemId={item.id} isActive={item.is_active} />
          </div>
        )}
      </div>

      {canManage && item.is_sale && item.is_active && !editing && (
        <StockAdjustForm item={item} />
      )}

      {editing && (
        <div className="border-t border-ink-200 bg-ink-50/50 px-4 py-4 sm:px-6">
          <EditItemForm
            item={item}
            canSeeCost={canSeeCost}
            onDone={() => setEditing(false)}
          />
        </div>
      )}
    </li>
  );
}

function EditItemForm({
  item,
  canSeeCost,
  onDone,
}: {
  item: CatalogItem;
  canSeeCost: boolean;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState<CatalogState, FormData>(
    updateCatalogItemAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="item_id" value={item.id} />

      {state.error && <Banner tone="error">{state.error}</Banner>}
      {state.success && <Banner tone="success">{state.success}</Banner>}

      <ItemFields
        idPrefix={`item-${item.id}`}
        item={item}
        canSeeCost={canSeeCost}
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

/** Inline stock correction — the common daily edit for supplies. */
function StockAdjustForm({ item }: { item: CatalogItem }) {
  const [state, formAction] = useActionState<CatalogState, FormData>(
    adjustStockAction,
    {},
  );

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center gap-2 border-t border-ink-200 bg-ink-50/50 px-4 py-2.5 sm:px-6"
    >
      <input type="hidden" name="item_id" value={item.id} />
      <label
        htmlFor={`stock-${item.id}`}
        className="text-xs font-medium text-ink-600"
      >
        Set stock
      </label>
      <input
        id={`stock-${item.id}`}
        name="stock_quantity"
        inputMode="numeric"
        defaultValue={String(item.stock_quantity)}
        className="tabular w-20 rounded-lg border border-ink-300 bg-surface px-2 py-1.5 text-[16px] text-ink-900 focus:border-brand-600 focus:outline focus:outline-2 focus:outline-brand-600/30"
      />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">
        Update
      </SubmitButton>
      {state.error && (
        <span className="text-xs font-medium text-danger-600">
          {state.error}
        </span>
      )}
      {state.success && (
        <span className="text-xs font-medium text-success-700">
          {state.success}
        </span>
      )}
    </form>
  );
}

function ArchiveButton({
  itemId,
  isActive,
}: {
  itemId: string;
  isActive: boolean;
}) {
  const [state, formAction] = useActionState<CatalogState, FormData>(
    setCatalogItemActiveAction,
    {},
  );

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="item_id" value={itemId} />
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
