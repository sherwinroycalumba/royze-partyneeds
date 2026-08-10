"use client";

import { useActionState, useState } from "react";

import {
  generateAgreementAction,
  setAgreementStatusAction,
  type AgreementState,
} from "@/lib/agreements/actions";
import {
  AGREEMENT_STATUS_LABELS,
  AGREEMENT_STATUS_TONES,
  allowedTransitions,
  canRegenerate,
  transitionLabel,
} from "@/lib/agreements/status";
import { formatDateTime } from "@/lib/date";
import type { AgreementStatus } from "@/lib/supabase/database.types";
import {
  Badge,
  Banner,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Field, TextInput } from "@/components/ui/field";
import { Button, buttonClasses } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * The rental agreement on a booking (Spec 4.5).
 *
 * Marking it signed is what opens half the Confirmed gate, so it is a
 * deliberate act with its own small form rather than a one-tap toggle:
 * staff tick it once the paper actually comes back, and may attach a
 * photo of the signed copy.
 */
export function AgreementCard({
  bookingId,
  agreement,
  canManage,
}: {
  bookingId: string;
  agreement: {
    id: string;
    agreement_number: string;
    status: AgreementStatus;
    sent_at: string | null;
    signed_at: string | null;
    signed_by_name: string;
    has_signed_copy: boolean;
  } | null;
  canManage: boolean;
}) {
  const [generateState, generateAction] = useActionState<
    AgreementState,
    FormData
  >(generateAgreementAction, {});

  if (!agreement) {
    return (
      <Card>
        <CardHeader
          title="Rental agreement"
          description="A signed agreement is one of the two things a booking needs before it can be confirmed."
        />
        <CardBody>
          {generateState.error && (
            <Banner tone="error">{generateState.error}</Banner>
          )}
          <p className="text-sm text-ink-600">
            No agreement generated yet.
          </p>
        </CardBody>
        {canManage && (
          <CardFooter>
            <form action={generateAction}>
              <input type="hidden" name="booking_id" value={bookingId} />
              <SubmitButton pendingLabel="Generating…">
                Generate agreement
              </SubmitButton>
            </form>
          </CardFooter>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Rental agreement"
        description={agreement.agreement_number}
        action={
          <Badge tone={AGREEMENT_STATUS_TONES[agreement.status]}>
            {AGREEMENT_STATUS_LABELS[agreement.status]}
          </Badge>
        }
      />
      <CardBody className="space-y-3">
        {generateState.error && (
          <Banner tone="error">{generateState.error}</Banner>
        )}
        {generateState.success && (
          <Banner tone="success">{generateState.success}</Banner>
        )}

        <dl className="space-y-1 text-sm text-ink-600">
          {agreement.sent_at && (
            <div>Sent {formatDateTime(agreement.sent_at)}</div>
          )}
          {agreement.signed_at && (
            <div>
              Signed {formatDateTime(agreement.signed_at)}
              {agreement.signed_by_name ? ` by ${agreement.signed_by_name}` : ""}
            </div>
          )}
          {agreement.has_signed_copy && (
            <div className="text-success-700">
              A photo of the signed copy is on file.
            </div>
          )}
        </dl>

        <div className="flex flex-wrap gap-2">
          <a
            href={`/bookings/${bookingId}/agreement`}
            className={buttonClasses("primary", "sm")}
          >
            Download PDF
          </a>

          {canManage && canRegenerate(agreement.status) && (
            <form action={generateAction}>
              <input type="hidden" name="booking_id" value={bookingId} />
              <SubmitButton
                variant="ghost"
                size="sm"
                pendingLabel="Re-generating…"
              >
                Re-generate
              </SubmitButton>
            </form>
          )}
        </div>

        {canManage && (
          <AgreementTransitions
            agreementId={agreement.id}
            status={agreement.status}
          />
        )}
      </CardBody>
    </Card>
  );
}

function AgreementTransitions({
  agreementId,
  status,
}: {
  agreementId: string;
  status: AgreementStatus;
}) {
  const [state, formAction] = useActionState<AgreementState, FormData>(
    setAgreementStatusAction,
    {},
  );
  const [signing, setSigning] = useState(false);

  const transitions = allowedTransitions(status);
  if (transitions.length === 0 && !state.error && !state.success) return null;

  return (
    <div className="space-y-2">
      {state.error && <Banner tone="error">{state.error}</Banner>}
      {state.success && <Banner tone="success">{state.success}</Banner>}

      <div className="flex flex-wrap gap-2">
        {transitions.map((target) =>
          target === "signed" ? (
            <Button
              key={target}
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setSigning((open) => !open)}
            >
              {transitionLabel(target)}
            </Button>
          ) : (
            <form key={target} action={formAction}>
              <input type="hidden" name="agreement_id" value={agreementId} />
              <input type="hidden" name="status" value={target} />
              <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">
                {transitionLabel(target)}
              </SubmitButton>
            </form>
          ),
        )}
      </div>

      {signing && (
        <form
          action={formAction}
          className="space-y-3 rounded-xl border border-ink-200 p-3"
        >
          <input type="hidden" name="agreement_id" value={agreementId} />
          <input type="hidden" name="status" value="signed" />

          <Field
            label="Who signed it"
            htmlFor="signed_by_name"
            hint="As written on the paper."
          >
            <TextInput id="signed_by_name" name="signed_by_name" />
          </Field>

          <Field
            label="Photo of the signed copy"
            htmlFor="signed_copy"
            hint="Optional. Kept private — not published anywhere."
          >
            <input
              id="signed_copy"
              name="signed_copy"
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              className="block w-full text-sm text-ink-700 file:mr-3 file:rounded-lg file:border-0 file:bg-ink-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink-800"
            />
          </Field>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSigning(false)}
            >
              Cancel
            </Button>
            <SubmitButton size="sm" pendingLabel="Saving…">
              Mark signed
            </SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
