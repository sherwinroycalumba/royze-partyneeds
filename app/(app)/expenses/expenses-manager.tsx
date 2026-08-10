"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import {
  categoriseExpenseAction,
  createExpenseAction,
  setExpensePaidAction,
  type ExpenseState,
} from "@/lib/expenses/actions";
import { agingBucketFor } from "@/lib/expenses/payables";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
} from "@/lib/payments/methods";
import { formatCalendarDate } from "@/lib/date";
import { formatPeso } from "@/lib/money";
import type { PaymentMethod, Supplier } from "@/lib/supabase/database.types";
import {
  Badge,
  Banner,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  ListSearch,
  useFiltered,
  useListSearch,
} from "@/components/ui/list-search";

export type ExpenseRow = {
  id: string;
  expense_date: string;
  payee: string;
  supplier_id: string | null;
  supplier_name: string | null;
  category: string;
  amount_centavos: number;
  method: PaymentMethod | null;
  reference_number: string;
  notes: string;
  is_paid: boolean;
  due_date: string | null;
  paid_on: string | null;
};

/** Records what the business spent (Spec 4.8). Owner only. */
export function RecordExpensePanel({
  categories,
  suppliers,
  today,
}: {
  categories: string[];
  suppliers: Supplier[];
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPaid, setIsPaid] = useState(true);
  const [state, formAction] = useActionState<ExpenseState, FormData>(
    createExpenseAction,
    {},
  );

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => setOpen(true)}>
          + Record expense
        </Button>
        {state.success && (
          <span className="text-sm font-medium text-success-700">
            {state.success}
          </span>
        )}
      </div>
    );
  }

  return (
    <Card>
      <form action={formAction}>
        <CardHeader
          title="Record an expense"
          description="Anything the business paid out. Leave it unpaid to turn it into a payable."
        />
        <CardBody className="space-y-4">
          {state.error && <Banner tone="error">{state.error}</Banner>}
          {state.success && <Banner tone="success">{state.success}</Banner>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" htmlFor="expense_date" required>
              <TextInput
                id="expense_date"
                name="expense_date"
                type="date"
                defaultValue={today}
                required
              />
            </Field>

            <Field label="Amount" htmlFor="amount" required>
              <TextInput
                id="amount"
                name="amount"
                inputMode="decimal"
                placeholder="0.00"
                required
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Paid to"
              htmlFor="payee"
              hint="A name is enough — a supplier record is optional."
              required
            >
              <TextInput id="payee" name="payee" required />
            </Field>

            <Field label="Supplier" htmlFor="supplier_id">
              <Select id="supplier_id" name="supplier_id" defaultValue="">
                <option value="">Not a listed supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" htmlFor="category" required>
              <Select id="category" name="category" defaultValue="" required>
                <option value="">Choose a category…</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="How it was paid" htmlFor="method">
              <Select id="method" name="method" defaultValue="cash">
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {PAYMENT_METHOD_LABELS[method]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-ink-200 p-3">
            <input
              type="checkbox"
              name="is_paid"
              checked={isPaid}
              onChange={(event) => setIsPaid(event.target.checked)}
              className="mt-0.5 size-5 accent-brand-600"
            />
            <span>
              <span className="block text-sm font-medium text-ink-800">
                Already paid
              </span>
              <span className="block text-xs text-ink-500">
                Untick to record it as a payable with a due date.
              </span>
            </span>
          </label>

          {isPaid ? (
            <Field label="Date paid" htmlFor="paid_on">
              <TextInput
                id="paid_on"
                name="paid_on"
                type="date"
                defaultValue={today}
                className="max-w-52"
              />
            </Field>
          ) : (
            <Field
              label="Due date"
              htmlFor="due_date"
              hint="A payable with no due date is one nobody chases."
              required
            >
              <TextInput
                id="due_date"
                name="due_date"
                type="date"
                className="max-w-52"
                required
              />
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reference number" htmlFor="reference_number">
              <TextInput id="reference_number" name="reference_number" />
            </Field>

            <Field
              label="Receipt"
              htmlFor="receipt"
              hint="Optional. Kept private."
            >
              <input
                id="receipt"
                name="receipt"
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                className="block w-full text-sm text-ink-700 file:mr-3 file:rounded-lg file:border-0 file:bg-ink-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink-800"
              />
            </Field>
          </div>

          <Field label="Notes" htmlFor="notes">
            <TextArea id="notes" name="notes" rows={2} />
          </Field>
        </CardBody>
        <CardFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          <SubmitButton pendingLabel="Saving…">Record expense</SubmitButton>
        </CardFooter>
      </form>
    </Card>
  );
}

export function ExpensesList({
  expenses,
  categories,
  today,
  isOwner,
  canCategorise,
}: {
  expenses: ExpenseRow[];
  categories: string[];
  today: string;
  isOwner: boolean;
  canCategorise: boolean;
}) {
  const [query, setQuery] = useListSearch();

  const visible = useFiltered(expenses, query, (expense) => [
    expense.payee,
    expense.supplier_name,
    expense.category,
    expense.reference_number,
    expense.notes,
  ]);

  return (
    <div className="space-y-4">
      <ListSearch
        id="expense-search"
        label="Search expenses"
        placeholder="Search payee, supplier, category, or reference"
        value={query}
        onChange={setQuery}
        resultCount={visible.length}
        totalCount={expenses.length}
        noun="expenses"
      />

      <Card>
        <CardHeader title="Expenses" description={`${expenses.length} shown.`} />

        {visible.length > 0 ? (
          <ul className="divide-y divide-ink-200">
            {visible.map((expense) => (
              <ExpenseRowView
                key={expense.id}
                expense={expense}
                categories={categories}
                today={today}
                isOwner={isOwner}
                canCategorise={canCategorise}
              />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-ink-500 sm:px-6">
            {expenses.length === 0
              ? "No expenses in this range."
              : `No expense matches “${query.trim()}”.`}
          </p>
        )}
      </Card>
    </div>
  );
}

function ExpenseRowView({
  expense,
  categories,
  today,
  isOwner,
  canCategorise,
}: {
  expense: ExpenseRow;
  categories: string[];
  today: string;
  isOwner: boolean;
  canCategorise: boolean;
}) {
  const [paidState, paidAction] = useActionState<ExpenseState, FormData>(
    setExpensePaidAction,
    {},
  );
  const [categoryState, categoryAction] = useActionState<ExpenseState, FormData>(
    categoriseExpenseAction,
    {},
  );

  const overdue =
    !expense.is_paid &&
    expense.due_date !== null &&
    expense.due_date < today;

  return (
    <li className="px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink-900">{expense.payee}</span>
          {!expense.is_paid && (
            <Badge tone={overdue ? "danger" : "warning"}>
              {overdue
                ? `Overdue · ${agingBucketFor(expense.due_date, today)}`
                : "Unpaid"}
            </Badge>
          )}
          {!expense.category && <Badge tone="neutral">Uncategorised</Badge>}
        </div>
        <span className="tabular font-bold text-ink-900">
          {formatPeso(expense.amount_centavos)}
        </span>
      </div>

      <p className="mt-0.5 text-sm text-ink-600">
        {formatCalendarDate(expense.expense_date)}
        {expense.category ? ` · ${expense.category}` : ""}
        {expense.method ? ` · ${PAYMENT_METHOD_LABELS[expense.method]}` : ""}
        {expense.supplier_id && expense.supplier_name ? (
          <>
            {" · "}
            <Link
              href={`/suppliers/${expense.supplier_id}`}
              className="font-medium text-brand-700 underline underline-offset-2"
            >
              {expense.supplier_name}
            </Link>
          </>
        ) : null}
      </p>

      {!expense.is_paid && expense.due_date && (
        <p className="mt-0.5 text-xs text-ink-500">
          Due {formatCalendarDate(expense.due_date)}
        </p>
      )}
      {expense.notes && (
        <p className="mt-0.5 text-xs text-ink-500">{expense.notes}</p>
      )}

      {(paidState.error || categoryState.error) && (
        <p className="mt-1 text-xs font-medium text-danger-600">
          {paidState.error ?? categoryState.error}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {isOwner && (
          <form action={paidAction}>
            <input type="hidden" name="expense_id" value={expense.id} />
            <input
              type="hidden"
              name="is_paid"
              value={String(!expense.is_paid)}
            />
            {/* Reopening needs a date back, or the payable would have
                nothing to be chased against. */}
            {expense.is_paid && (
              <input type="hidden" name="due_date" value={today} />
            )}
            <SubmitButton
              variant={expense.is_paid ? "ghost" : "primary"}
              size="sm"
              pendingLabel="Saving…"
            >
              {expense.is_paid ? "Mark unpaid" : "Mark paid"}
            </SubmitButton>
          </form>
        )}

        {canCategorise && !expense.category && (
          <form action={categoryAction} className="flex items-center gap-2">
            <input type="hidden" name="expense_id" value={expense.id} />
            <Select name="category" defaultValue="" className="max-w-52">
              <option value="">Categorise…</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
            <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">
              Save
            </SubmitButton>
          </form>
        )}
      </div>
    </li>
  );
}
