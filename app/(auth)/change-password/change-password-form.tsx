"use client";

import { useActionState } from "react";

import { changePasswordAction } from "@/lib/auth/actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import type { FormState } from "@/lib/forms";
import { Banner } from "@/components/ui/card";
import { Field, TextInput } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function ChangePasswordForm() {
  const [state, formAction] = useActionState<FormState, FormData>(
    changePasswordAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error && <Banner tone="error">{state.error}</Banner>}

      <Field
        label="New password"
        htmlFor="password"
        required
        hint={`At least ${MIN_PASSWORD_LENGTH} characters, with a letter and a number.`}
      >
        <TextInput
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
        />
      </Field>

      <Field label="Confirm new password" htmlFor="confirm" required>
        <TextInput
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
        />
      </Field>

      <SubmitButton className="w-full" pendingLabel="Saving…">
        Set password and continue
      </SubmitButton>
    </form>
  );
}
