"use client";

import { useActionState, useState } from "react";

import { moveAssetAction, type AssetState } from "@/lib/assets/actions";
import {
  ASSET_MOVE_LABELS,
  type AssetBreakdown,
  type AssetMove,
} from "@/lib/assets/status";
import { formatPeso } from "@/lib/money";
import { Badge, Banner, Card, CardHeader } from "@/components/ui/card";
import { Field, Select, TextInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  ListSearch,
  useFiltered,
  useListSearch,
} from "@/components/ui/list-search";

export type AssetRow = AssetBreakdown & {
  id: string;
  name: string;
  category: string;
  replacement_value_centavos: number;
  overcommitted: boolean;
};

/**
 * The equipment register (Spec 4.9), and the Owner's route out of the
 * damaged pile — the half of Spec 4.4 that Milestone 4 left open.
 */
export function AssetManager({
  assets,
  isOwner,
}: {
  assets: AssetRow[];
  isOwner: boolean;
}) {
  const [query, setQuery] = useListSearch();

  const visible = useFiltered(assets, query, (asset) => [
    asset.name,
    asset.category,
  ]);

  const needsAttention = assets.filter(
    (asset) =>
      asset.damaged_quantity > 0 ||
      asset.under_repair_quantity > 0 ||
      asset.overcommitted,
  );

  return (
    <div className="space-y-4">
      {needsAttention.length > 0 && (
        <Banner tone="warning">
          {needsAttention.length}{" "}
          {needsAttention.length === 1 ? "item needs" : "items need"} a
          decision — broken, away for repair, or booked past what is owned.
        </Banner>
      )}

      <ListSearch
        id="asset-search"
        label="Search equipment"
        placeholder="Search equipment by name or category"
        value={query}
        onChange={setQuery}
        resultCount={visible.length}
        totalCount={assets.length}
        noun="items"
      />

      <Card>
        <CardHeader
          title="Equipment"
          description={`${assets.length} rental items.`}
        />

        {visible.length > 0 ? (
          <ul className="divide-y divide-ink-200">
            {visible.map((asset) => (
              <AssetRowView key={asset.id} asset={asset} isOwner={isOwner} />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-ink-500 sm:px-6">
            {assets.length === 0
              ? "No rental items in the catalog yet."
              : `Nothing matches “${query.trim()}”.`}
          </p>
        )}
      </Card>
    </div>
  );
}

function AssetRowView({
  asset,
  isOwner,
}: {
  asset: AssetRow;
  isOwner: boolean;
}) {
  const [state, formAction] = useActionState<AssetState, FormData>(
    moveAssetAction,
    {},
  );
  const [open, setOpen] = useState(false);

  const canMove =
    isOwner && (asset.damaged_quantity > 0 || asset.under_repair_quantity > 0);

  // Only offer moves the item actually has stock for.
  const moves: AssetMove[] = [
    ...(asset.damaged_quantity > 0
      ? (["repaired_from_damaged", "sent_for_repair", "written_off_from_damaged"] as const)
      : []),
    ...(asset.under_repair_quantity > 0
      ? (["repaired_from_repair", "written_off_from_repair"] as const)
      : []),
  ];

  return (
    <li className="px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink-900">{asset.name}</span>
          {asset.overcommitted && (
            <Badge tone="danger">Booked past what is owned</Badge>
          )}
        </div>
        <span className="tabular text-sm text-ink-600">
          {asset.quantity_owned} owned
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <Count label="Available" value={asset.available} tone="success" />
        <Count label="Reserved" value={asset.reserved} tone="warning" />
        <Count label="Out on rental" value={asset.out_on_rental} tone="brand" />
        <Count label="Damaged" value={asset.damaged_quantity} tone="danger" />
        <Count
          label="Under repair"
          value={asset.under_repair_quantity}
          tone="neutral"
        />
        <Count
          label="Written off"
          value={asset.written_off_quantity}
          tone="neutral"
        />
      </div>

      {asset.replacement_value_centavos > 0 && (
        <p className="mt-1 text-xs text-ink-500">
          {formatPeso(asset.replacement_value_centavos)} to replace each
        </p>
      )}

      {state.error && (
        <p className="mt-1 text-xs font-medium text-danger-600">{state.error}</p>
      )}
      {state.success && (
        <p className="mt-1 text-xs font-medium text-success-700">
          {state.success}
        </p>
      )}

      {canMove && !open && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-2"
          onClick={() => setOpen(true)}
        >
          Move broken stock
        </Button>
      )}

      {canMove && open && (
        <form
          action={formAction}
          className="mt-2 grid gap-2 rounded-xl border border-ink-200 p-3 sm:grid-cols-[1fr_6rem_auto]"
        >
          <input type="hidden" name="item_id" value={asset.id} />

          <Field label="What happened" htmlFor={`move-${asset.id}`}>
            <Select id={`move-${asset.id}`} name="move" defaultValue={moves[0]}>
              {moves.map((move) => (
                <option key={move} value={move}>
                  {ASSET_MOVE_LABELS[move]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="How many" htmlFor={`qty-${asset.id}`}>
            <TextInput
              id={`qty-${asset.id}`}
              name="quantity"
              inputMode="numeric"
              defaultValue="1"
              required
            />
          </Field>

          <div className="flex items-end gap-2">
            <SubmitButton size="sm" pendingLabel="Saving…">
              Apply
            </SubmitButton>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

function Count({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "brand" | "success" | "warning" | "danger";
}) {
  // Zeroes are noise on a register this wide; only Available always
  // shows, because "0 available" is the thing staff most need to see.
  if (value === 0 && label !== "Available") return null;

  const tones = {
    neutral: "bg-ink-100 text-ink-700",
    brand: "bg-brand-100 text-brand-700",
    success: "bg-success-100 text-success-700",
    warning: "bg-warning-100 text-warning-700",
    danger: "bg-danger-100 text-danger-700",
  } as const;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}
    >
      <span className="tabular">{value}</span>
      {label}
    </span>
  );
}
