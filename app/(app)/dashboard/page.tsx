import type { Metadata } from "next";
import Link from "next/link";

import {
  getBusinessSettings,
  getPaymentAccounts,
  requireUser,
} from "@/lib/auth/dal";
import { activeAccounts } from "@/lib/settings/payment-accounts";
import { can, ROLE_LABELS } from "@/lib/auth/permissions";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/date";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Milestone 1 dashboard: identity, role, and a setup checklist.
 * Bookings, receivables, and stock widgets arrive with their modules.
 */
export default async function DashboardPage() {
  const profile = await requireUser();
  const settings = await getBusinessSettings();
  const paymentAccounts = await getPaymentAccounts();

  const setupTasks = settings
    ? [
        {
          label: "Add your business address",
          done: settings.address.trim().length > 0,
        },
        {
          label: "Add a contact number",
          done: settings.contact_numbers.length > 0,
        },
        {
          label: "Set up payment channels (GCash / Maya / bank)",
          done: activeAccounts(paymentAccounts).length > 0,
        },
        {
          label: "Upload your logo for quotations and agreements",
          done: Boolean(settings.logo_url),
        },
        {
          label: "Add your TIN",
          done: Boolean(settings.tin),
        },
      ]
    : [];

  const remaining = setupTasks.filter((task) => !task.done);
  const isOwner = profile.role === "owner";

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <header>
        <p className="text-sm text-ink-500">{formatDate(new Date())}</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-ink-900">
          Welcome back, {profile.full_name.split(" ")[0] || "there"}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone="brand">{ROLE_LABELS[profile.role]}</Badge>
          {profile.role === "booking_staff" && profile.catalog_manager && (
            <Badge tone="neutral">Catalog manager</Badge>
          )}
        </div>
      </header>

      {isOwner && remaining.length > 0 && (
        <Card>
          <CardHeader
            title="Finish setting up"
            description="These details appear on your quotations and rental agreements."
            action={
              <Link
                href="/settings"
                className="text-sm font-semibold text-brand-600 hover:text-brand-700"
              >
                Open settings →
              </Link>
            }
          />
          <CardBody>
            <ul className="space-y-2.5">
              {setupTasks.map((task) => (
                <li key={task.label} className="flex items-center gap-2.5">
                  <span
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full ${
                      task.done
                        ? "bg-success-100 text-success-700"
                        : "bg-ink-100 text-ink-400"
                    }`}
                    aria-hidden="true"
                  >
                    {task.done ? (
                      <svg
                        className="size-3.5"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : (
                      <span className="size-1.5 rounded-full bg-current" />
                    )}
                  </span>
                  <span
                    className={`text-sm ${
                      task.done
                        ? "text-ink-400 line-through"
                        : "text-ink-700"
                    }`}
                  >
                    {task.label}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="What you can do"
          description="Your role determines which parts of the system you can open."
        />
        <CardBody>
          <ul className="grid gap-2 text-sm text-ink-700 sm:grid-cols-2">
            {can(profile, "bookings.manage") && (
              <li>Create and edit bookings, quotations, and orders</li>
            )}
            {can(profile, "delivery.update") && (
              <li>Update delivery and return status</li>
            )}
            {can(profile, "payments.record") && (
              <li>Record payments received</li>
            )}
            {can(profile, "payments.verify") && (
              <li>Verify GCash, Maya, and bank transfer payments</li>
            )}
            {can(profile, "catalog.manage") && (
              <li>Manage the price catalog and backdrop packages</li>
            )}
            {can(profile, "reports.financial.view") && (
              <li>View financial reports</li>
            )}
            {can(profile, "reports.export") && (
              <li>Export reports as CSV and PDF</li>
            )}
            {can(profile, "users.manage") && (
              <li>Create staff accounts and assign roles</li>
            )}
            {can(profile, "settings.manage") && (
              <li>Edit business settings and agreement templates</li>
            )}
          </ul>
        </CardBody>
      </Card>

      <p className="px-1 text-xs text-ink-500">
        Bookings, calendar, catalog, and reports arrive in the next milestones.
      </p>
    </div>
  );
}
