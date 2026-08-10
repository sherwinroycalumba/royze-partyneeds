"use client";

import { useActionState, useState } from "react";

import { voidOrderAction, type OrderState } from "@/lib/orders/actions";
import { Banner, Card, CardBody, CardFooter } from "@/components/ui/card";
import { Field, TextInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Voiding a sale (Spec 4.6). Owner only, and it needs a reason: the
 * stock goes back on the shelf and the payment comes off the books, so
 * the record has to say why.
 */
export function VoidOrderButton({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState<OrderState, FormData>(
    voidOrderAction,
    {},
  );
  const [open, setOpen] = useState(false);

  if (state.success) {
    return <Banner tone="success">{state.success}</Banner>;
  }

  if (!open) {
    return (
      <div className="space-y-2">
        {state.error && <Banner tone="error">{state.error}</Banner>}
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={() => setOpen(true)}
        >
          Void this sale
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <form action={formAction}>
        <input type="hidden" name="order_id" value={orderId} />
        <CardBody className="space-y-3">
          {state.error && <Banner tone="error">{state.error}</Banner>}
          <Field
            label="Why is this sale being voided?"
            htmlFor="voided_reason"
            hint="The stock goes back and the payment is struck off. Both stay on the record."
          >
            <TextInput id="voided_reason" name="voided_reason" required />
          </Field>
        </CardBody>
        <CardFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <SubmitButton variant="danger" pendingLabel="Voiding…">
            Void sale
          </SubmitButton>
        </CardFooter>
      </form>
    </Card>
  );
}
