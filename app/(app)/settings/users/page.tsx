import type { Metadata } from "next";

import { requireOwner } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { Banner, Card, CardHeader } from "@/components/ui/card";
import { CreateUserPanel, UserRow } from "./users-manager";

export const metadata: Metadata = { title: "Users & Roles" };

export default async function UsersPage() {
  const owner = await requireOwner();

  const supabase = await createClient();
  const { data: users, error } = await supabase
    .from("profiles")
    .select("*")
    // Active accounts first, then alphabetically — deactivated staff
    // stay visible because audit history still points at them.
    .order("is_active", { ascending: false })
    .order("full_name", { ascending: true });

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          Settings
        </p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-ink-900">
          Users &amp; Roles
        </h1>
        <p className="mt-1 text-sm text-ink-600">
          Create staff accounts and control what each person can do.
        </p>
      </header>

      <CreateUserPanel />

      {error && <Banner tone="error">Could not load users: {error.message}</Banner>}

      <Card>
        <CardHeader
          title="Accounts"
          description={`${users?.length ?? 0} total. Accounts are deactivated, never deleted, so records keep their history.`}
        />
        {users && users.length > 0 ? (
          <ul>
            {users.map((user) => (
              <UserRow key={user.id} user={user} isSelf={user.id === owner.id} />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-ink-500 sm:px-6">
            No accounts yet.
          </p>
        )}
      </Card>

      <Card>
        <CardHeader title="What each role can do" />
        <dl className="divide-y divide-ink-200">
          {(
            [
              [
                "owner",
                "Full access. The only role that can verify payments, manage users and settings, view financial reports, and delete records.",
              ],
              [
                "booking_staff",
                "Creates customers, bookings, quotations, orders, and agreements. Records payments as pending verification. Can manage the catalog only if granted the flag.",
              ],
              [
                "delivery_staff",
                "Read-only calendar and booking details. Updates delivery and return status, and records item condition on return.",
              ],
              [
                "bookkeeper",
                "Read-only access to financial data. Categorizes expenses and exports reports for BIR filing.",
              ],
            ] as const
          ).map(([role, description]) => (
            <div key={role} className="px-4 py-3 sm:flex sm:gap-4 sm:px-6">
              <dt className="w-40 shrink-0 text-sm font-semibold text-ink-900">
                {ROLE_LABELS[role]}
              </dt>
              <dd className="mt-0.5 text-sm text-ink-600 sm:mt-0">
                {description}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
