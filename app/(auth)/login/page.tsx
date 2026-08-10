import type { Metadata } from "next";

import { BrandLock } from "@/components/brand/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · Royze Party Needs Rental",
};

const ERROR_MESSAGES: Record<string, string> = {
  deactivated: "This account has been deactivated. Contact the owner.",
};

export default async function LoginPage(props: PageProps<"/login">) {
  const { next, error } = await props.searchParams;

  const nextPath = typeof next === "string" ? next : undefined;
  const errorKey = typeof error === "string" ? error : undefined;

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex flex-col items-center text-center">
        <BrandLock compact className="scale-125" />
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-ink-900">
          Royze Party Needs Rental
        </h1>
        <p className="mt-1 text-sm text-ink-600">
          Sign in to manage bookings, rentals, and supplies.
        </p>
      </div>

      <div className="rounded-2xl border border-ink-200 bg-surface p-6 shadow-sm">
        <LoginForm
          next={nextPath}
          initialError={errorKey ? ERROR_MESSAGES[errorKey] : undefined}
        />
      </div>

      <p className="mt-6 text-center text-xs text-ink-500">
        Staff accounts are created by the owner. Forgot your password? Ask the
        owner to reset it for you.
      </p>
    </div>
  );
}
