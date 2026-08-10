"use client";

import { useActionState } from "react";

import { signInAction } from "@/lib/auth/actions";
import type { FormState } from "@/lib/forms";
import { Banner } from "@/components/ui/card";
import { Field, TextInput } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function LoginForm({
  next,
  initialError,
}: {
  next?: string;
  initialError?: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    signInAction,
    { error: initialError },
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error && <Banner tone="error">{state.error}</Banner>}

      <input type="hidden" name="next" value={next ?? ""} />

      <Field label="Email" htmlFor="email" required>
        <TextInput
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          required
          placeholder="you@royzepartyneeds.com"
        />
      </Field>

      <Field label="Password" htmlFor="password" required>
        <TextInput
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
        />
      </Field>

      <SubmitButton className="w-full" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
