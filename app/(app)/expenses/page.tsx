import type { Metadata } from "next";

import { getBusinessSettings, requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { todayInManila } from "@/lib/date";
import { isCalendarDate } from "@/lib/documents/totals";
import {
  summarisePayables,
  totalsByCategory,
  uncategorisedCount,
} from "@/lib/expenses/payables";
import { formatPeso } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { buttonClasses } from "@/components/ui/button";
import { Banner, Card, CardBody, CardHeader } from "@/components/ui/card";
import { inputClasses } from "@/components/ui/field";
import {
  ExpensesList,
  RecordExpensePanel,
  type ExpenseRow,
} from "./expenses-manager";

export const metadata: Metadata = { title: "Expenses" };

const ROW_CAP = 500;

export default async function ExpensesPage({
  searchParams,
}: {
  // Next 16: searchParams is async.
  searchParams: Promise<{
    from?: string;
    to?: string;
    category?: string;
    status?: string;
  }>;
}) {
  // The Bookkeeper reads and categorises; the Owner does everything.
  const profile = await requirePermission("expenses.categorize");
  const { from, to, category = "all", status = "all" } = await searchParams;

  const isOwner = profile.role === "owner";
  const today = todayInManila();

  const supabase = await createClient();
  const settings = await getBusinessSettings();

  let query = supabase
    .from("expenses")
    .select("*, suppliers(id, name)")
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(ROW_CAP);

  if (status === "unpaid") query = query.eq("is_paid", false);
  if (status === "paid") query = query.eq("is_paid", true);
  if (category !== "all") query = query.eq("category", category);
  if (from && isCalendarDate(from)) query = query.gte("expense_date", from);
  if (to && isCalendarDate(to)) query = query.lte("expense_date", to);

  const { data, error } = await query;

  const rows: ExpenseRow[] = (data ?? []).map((expense) => ({
    id: expense.id,
    expense_date: expense.expense_date,
    payee: expense.payee,
    supplier_id: expense.supplier_id,
    supplier_name: expense.suppliers?.name ?? null,
    category: expense.category,
    amount_centavos: expense.amount_centavos,
    method: expense.method,
    reference_number: expense.reference_number,
    notes: expense.notes,
    is_paid: expense.is_paid,
    due_date: expense.due_date,
    paid_on: expense.paid_on,
  }));

  const summary = summarisePayables(rows, today);
  const byCategory = totalsByCategory(rows);
  const uncategorised = uncategorisedCount(rows);

  const [{ data: suppliers }] = await Promise.all([
    supabase
      .from("suppliers")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  const categories = settings?.expense_categories ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          Expenses
        </h1>
        <p className="mt-1 text-sm text-ink-600">
          What the business paid out, and what it still owes. Categories come
          from Settings, and drive the bookkeeper&rsquo;s filing report.
        </p>
      </header>

      {isOwner && (
        <RecordExpensePanel
          categories={categories}
          suppliers={suppliers ?? []}
          today={today}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-sm text-ink-600">Paid in this view</p>
            <p className="tabular text-xl font-bold text-ink-900">
              {formatPeso(summary.paid_centavos)}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-ink-600">Still owed</p>
            <p className="tabular text-xl font-bold text-warning-700">
              {formatPeso(summary.outstanding_centavos)}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-ink-600">Overdue</p>
            <p className="tabular text-xl font-bold text-danger-600">
              {formatPeso(summary.overdue_centavos)}
            </p>
            {summary.overdue_count > 0 && (
              <p className="text-xs text-ink-500">
                {summary.overdue_count} past its due date
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      {uncategorised > 0 && (
        <Banner tone="warning">
          {uncategorised}{" "}
          {uncategorised === 1 ? "expense has" : "expenses have"} no category
          yet, so they will not appear under any heading in the filing report.
        </Banner>
      )}

      <form
        action="/expenses"
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
      >
        <div>
          <label htmlFor="expense-status" className="sr-only">
            Status
          </label>
          <select
            id="expense-status"
            name="status"
            defaultValue={status}
            className={inputClasses}
          >
            <option value="all">Paid and unpaid</option>
            <option value="unpaid">Unpaid only</option>
            <option value="paid">Paid only</option>
          </select>
        </div>

        <div>
          <label htmlFor="expense-category" className="sr-only">
            Category
          </label>
          <select
            id="expense-category"
            name="category"
            defaultValue={category}
            className={inputClasses}
          >
            <option value="all">All categories</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="expense-from" className="sr-only">
            From
          </label>
          <input
            id="expense-from"
            name="from"
            type="date"
            defaultValue={from ?? ""}
            className={inputClasses}
          />
        </div>

        <div>
          <label htmlFor="expense-to" className="sr-only">
            To
          </label>
          <input
            id="expense-to"
            name="to"
            type="date"
            defaultValue={to ?? ""}
            className={inputClasses}
          />
        </div>

        <button type="submit" className={buttonClasses("secondary")}>
          Show
        </button>
      </form>

      {error && (
        <Banner tone="error">Could not load expenses: {error.message}</Banner>
      )}

      {byCategory.length > 0 && (
        <Card>
          <CardHeader
            title="Where it went"
            description="Totals for the range shown."
          />
          <CardBody>
            <dl className="space-y-1.5 text-sm">
              {byCategory.map((entry) => (
                <div
                  key={entry.category}
                  className="flex items-baseline justify-between"
                >
                  <dt className="text-ink-600">
                    {entry.category}{" "}
                    <span className="text-xs text-ink-400">
                      ({entry.count})
                    </span>
                  </dt>
                  <dd className="tabular font-semibold text-ink-900">
                    {formatPeso(entry.total_centavos)}
                  </dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      )}

      <ExpensesList
        expenses={rows}
        categories={categories}
        today={today}
        isOwner={isOwner}
        canCategorise={can(profile, "expenses.categorize")}
      />
    </div>
  );
}
