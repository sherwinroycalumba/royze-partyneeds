"use client";

import { useActionState, useState } from "react";

import {
  recordReturnAction,
  setBookingStatusAction,
  type BookingState,
} from "@/lib/bookings/actions";
import { allowedTransitions, transitionLabel } from "@/lib/bookings/status";
import {
  RETURN_CONDITION_LABELS,
  RETURN_CONDITIONS,
} from "@/lib/bookings/returns";
import { formatPeso } from "@/lib/money";
import type {
  BookingStatus,
  ReturnCondition,
} from "@/lib/supabase/database.types";
import { Banner, Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * The moves available from where this booking actually stands
 * (Spec 4.4). The list comes from the same transition table the server
 * action checks, so a button can never offer a move the server refuses.
 */
export function BookingStatusActions({
  bookingId,
  status,
  isOwner,
  confirmationBlockers,
}: {
  bookingId: string;
  status: BookingStatus;
  isOwner: boolean;
  /** Why Confirmed is still out of reach, if it is. */
  confirmationBlockers: string[];
}) {
  const [state, formAction] = useActionState<BookingState, FormData>(
    setBookingStatusAction,
    {},
  );
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const transitions = allowedTransitions(status);
  const blocked = confirmationBlockers.length > 0;

  return (
    <div className="space-y-3">
      {state.error && <Banner tone="error">{state.error}</Banner>}
      {state.success && <Banner tone="success">{state.success}</Banner>}

      {transitions.includes("confirmed") && blocked && (
        <Banner tone="warning">
          <span className="block font-semibold">Not ready to confirm</span>
          <ul className="mt-1 list-disc pl-5 font-normal">
            {confirmationBlockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </Banner>
      )}

      <div className="flex flex-wrap gap-2">
        {transitions.map((target) => {
          // Confirming past the gate, and cancelling, both need a
          // reason — so they open a small form instead of firing.
          if (target === "confirmed" && blocked) {
            return isOwner ? (
              <Button
                key={target}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setConfirming((open) => !open)}
              >
                Confirm anyway (owner)
              </Button>
            ) : null;
          }

          if (target === "cancelled") {
            return (
              <Button
                key={target}
                type="button"
                variant="danger"
                size="sm"
                onClick={() => setCancelling((open) => !open)}
              >
                {transitionLabel(target)}
              </Button>
            );
          }

          return (
            <form key={target} action={formAction}>
              <input type="hidden" name="booking_id" value={bookingId} />
              <input type="hidden" name="status" value={target} />
              <SubmitButton
                variant={target === "confirmed" ? "primary" : "secondary"}
                size="sm"
                pendingLabel="Saving…"
              >
                {transitionLabel(target)}
              </SubmitButton>
            </form>
          );
        })}
      </div>

      {confirming && (
        <Card>
          <form action={formAction}>
            <input type="hidden" name="booking_id" value={bookingId} />
            <input type="hidden" name="status" value="confirmed" />
            <CardBody>
              <Field
                label="Reason for confirming without the usual requirements"
                htmlFor="override_reason"
                hint="Owner only. Saved to the audit trail."
              >
                <TextInput
                  id="override_reason"
                  name="override_reason"
                  placeholder="e.g. paid cash at the shop, signing on delivery"
                  required
                />
              </Field>
            </CardBody>
            <CardFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <SubmitButton pendingLabel="Confirming…">
                Confirm booking
              </SubmitButton>
            </CardFooter>
          </form>
        </Card>
      )}

      {cancelling && (
        <Card>
          <form action={formAction}>
            <input type="hidden" name="booking_id" value={bookingId} />
            <input type="hidden" name="status" value="cancelled" />
            <CardBody>
              <Field
                label="Why is this booking being cancelled?"
                htmlFor="cancellation_reason"
                hint="Goes on the record and on the customer's history."
              >
                <TextInput
                  id="cancellation_reason"
                  name="cancellation_reason"
                  required
                />
              </Field>
            </CardBody>
            <CardFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCancelling(false)}
              >
                Keep it
              </Button>
              <SubmitButton variant="danger" pendingLabel="Cancelling…">
                Cancel booking
              </SubmitButton>
            </CardFooter>
          </form>
        </Card>
      )}
    </div>
  );
}

export type ReturnLine = {
  id: string;
  description: string;
  quantity: number;
  replacement_value_centavos: number;
  return_condition: ReturnCondition;
  return_notes: string;
  damaged_quantity: number;
  lost_quantity: number;
};

/**
 * The return sheet Delivery Staff fill in on a phone (Spec 4.4).
 *
 * Anything damaged or lost raises a charge at replacement value, so
 * the value is shown next to each line — nobody should be recording a
 * charge without seeing what it will cost the customer.
 */
export function ReturnForm({
  bookingId,
  lines,
}: {
  bookingId: string;
  lines: ReturnLine[];
}) {
  const [state, formAction] = useActionState<BookingState, FormData>(
    recordReturnAction,
    {},
  );

  return (
    <Card>
      <form action={formAction}>
        <input type="hidden" name="booking_id" value={bookingId} />
        <CardHeader
          title="Check the items back in"
          description="Anything damaged or lost is charged at its replacement value and comes off the available stock."
        />
        <CardBody className="space-y-4">
          {state.error && <Banner tone="error">{state.error}</Banner>}
          {state.success && <Banner tone="success">{state.success}</Banner>}

          {lines.map((line) => (
            <ReturnRow key={line.id} line={line} />
          ))}
        </CardBody>
        <CardFooter>
          <SubmitButton pendingLabel="Saving…">Record return</SubmitButton>
        </CardFooter>
      </form>
    </Card>
  );
}

function ReturnRow({ line }: { line: ReturnLine }) {
  const [condition, setCondition] = useState<ReturnCondition>(
    line.return_condition,
  );
  const [damaged, setDamaged] = useState(String(line.damaged_quantity || ""));
  const [lost, setLost] = useState(String(line.lost_quantity || ""));

  const needsCounts = condition === "damaged" || condition === "lost";

  /**
   * The count inputs always post — hiding them with CSS would leave
   * them in the form and rendering a second pair of hidden inputs
   * would post each field twice, knocking the parallel arrays out of
   * step on the server. So they are controlled, and clearing the
   * condition clears the counts with it.
   */
  function changeCondition(next: ReturnCondition) {
    setCondition(next);
    if (next !== "damaged" && next !== "lost") {
      setDamaged("");
      setLost("");
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-ink-200 p-3">
      <input type="hidden" name="return_item_id" value={line.id} />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-ink-900">{line.description}</p>
        <p className="text-xs text-ink-500">
          {line.quantity} out ·{" "}
          {formatPeso(line.replacement_value_centavos)} each to replace
        </p>
      </div>

      <Field label="Condition" htmlFor={`condition-${line.id}`}>
        <Select
          id={`condition-${line.id}`}
          name="return_condition"
          value={condition}
          onChange={(event) =>
            changeCondition(event.target.value as ReturnCondition)
          }
        >
          {RETURN_CONDITIONS.map((value) => (
            <option key={value} value={value}>
              {RETURN_CONDITION_LABELS[value]}
            </option>
          ))}
        </Select>
      </Field>

      <div className={needsCounts ? "grid grid-cols-2 gap-3" : "hidden"}>
        <Field label="How many damaged" htmlFor={`damaged-${line.id}`}>
          <TextInput
            id={`damaged-${line.id}`}
            name="return_damaged"
            inputMode="numeric"
            value={damaged}
            onChange={(event) => setDamaged(event.target.value)}
            placeholder="0"
          />
        </Field>
        <Field label="How many lost" htmlFor={`lost-${line.id}`}>
          <TextInput
            id={`lost-${line.id}`}
            name="return_lost"
            inputMode="numeric"
            value={lost}
            onChange={(event) => setLost(event.target.value)}
            placeholder="0"
          />
        </Field>
      </div>

      <Field
        label="Notes"
        htmlFor={`notes-${line.id}`}
        hint={needsCounts ? "Required before a customer is charged." : undefined}
      >
        <TextArea
          id={`notes-${line.id}`}
          name="return_notes"
          rows={2}
          defaultValue={line.return_notes}
        />
      </Field>
    </div>
  );
}
