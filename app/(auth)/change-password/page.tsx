import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireUserAllowingPasswordChange } from "@/lib/auth/dal";
import { BrandLock } from "@/components/brand/logo";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = {
  title: "Set your password · Royze Party Needs Rental",
};

export default async function ChangePasswordPage() {
  const profile = await requireUserAllowingPasswordChange();

  // Reachable only while a forced change is pending; otherwise this
  // screen would be a dead end for users who navigate here directly.
  if (!profile.must_change_password) {
    redirect("/dashboard");
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex flex-col items-center text-center">
        <BrandLock compact className="scale-125" />
        <h1 className="mt-4 text-xl font-bold tracking-tight text-ink-900">
          Set your password
        </h1>
        <p className="mt-1 text-sm text-ink-600">
          You&apos;re signed in as{" "}
          <span className="font-medium text-ink-800">{profile.email}</span>.
          Choose your own password before continuing.
        </p>
      </div>

      <div className="rounded-2xl border border-ink-200 bg-surface p-6 shadow-sm">
        <ChangePasswordForm />
      </div>
    </div>
  );
}
