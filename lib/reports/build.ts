import "server-only";

import { documentTotals, lineTotal } from "@/lib/documents/totals";
import { summarisePayables, totalsByCategory } from "@/lib/expenses/payables";
import { orderTotals } from "@/lib/orders/totals";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments/methods";
import type { PaymentMethod } from "@/lib/supabase/database.types";
import { BOOKING_STATUS_LABELS } from "@/lib/bookings/status";
import { sumCentavos } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { todayInManila } from "@/lib/date";
import {
  receivableBucket,
  totalsByBucket,
  RECEIVABLE_BUCKETS,
  type AgedBalance,
} from "./aging";
import {
  addMix,
  documentRevenueMix,
  emptyMix,
  mixTotal,
  recogniseRevenue,
  REVENUE_SOURCES,
  REVENUE_SOURCE_LABELS,
  type RevenueLine,
  type RevenueMix,
} from "./revenue";
import type { Report, ReportKind, ReportRow, ReportSection } from "./types";
import { REPORT_DESCRIPTIONS, REPORT_LABELS } from "./types";

/**
 * The eight reports (Spec 4.11), each over a date range.
 *
 * Cash-basis throughout: revenue is recognised when a payment is
 * **verified**, never when a booking is made. A pending GCash claim
 * contributes nothing to any figure here, which is the same rule the
 * 50%-confirmation gate uses.
 */

export type ReportRange = { from: string; to: string };

/** Which revenue bucket a booking line belongs to. */
function sourceForLine(lineType: string): RevenueLine["source"] {
  switch (lineType) {
    case "package":
      return "package";
    case "sale":
      return "sale";
    case "damage_charge":
      return "damage";
    default:
      return "rental";
  }
}

export async function buildReport(
  kind: ReportKind,
  range: ReportRange,
): Promise<Report> {
  const base = {
    kind,
    title: REPORT_LABELS[kind],
    subtitle: REPORT_DESCRIPTIONS[kind],
    range,
  };

  switch (kind) {
    case "profit-and-loss":
      return { ...base, ...(await profitAndLoss(range)) };
    case "daily-sales":
      return { ...base, ...(await dailySales(range)) };
    case "receivables":
      return { ...base, ...(await receivables()) };
    case "payables":
      return { ...base, ...(await payables()) };
    case "bookings":
      return { ...base, ...(await bookingSummary(range)) };
    case "inventory":
      return { ...base, ...(await inventory(range)) };
    case "customers":
      return { ...base, ...(await customers(range)) };
    case "expenses":
      return { ...base, ...(await expenses(range)) };
  }
}

type Body = Pick<Report, "highlights" | "sections">;

/**
 * Every verified payment in the range, with the revenue mix of what it
 * was paid against. This is the spine of the cash-basis reports.
 */
async function recognisedRevenue(range: ReportRange): Promise<{
  mix: RevenueMix;
  byMethod: Map<PaymentMethod, number>;
  byDay: Map<string, Map<PaymentMethod, number>>;
  byCustomer: Map<string, { name: string; amount: number }>;
  total: number;
}> {
  const supabase = await createClient();

  const { data: payments } = await supabase
    .from("payments")
    .select(
      "amount_centavos, method, paid_on, booking_id, order_id, bookings(id, discount_centavos, delivery_fee_centavos, within_free_delivery_area, customers(id, name), booking_items(line_type, quantity, unit_price_centavos, line_discount_centavos, is_component)), orders(id, discount_centavos, customer_label, customers(id, name), order_items(quantity, unit_price_centavos, line_discount_centavos))",
    )
    .eq("status", "verified")
    .gte("paid_on", range.from)
    .lte("paid_on", range.to);

  let mix = emptyMix();
  const byMethod = new Map<PaymentMethod, number>();
  const byDay = new Map<string, Map<PaymentMethod, number>>();
  const byCustomer = new Map<string, { name: string; amount: number }>();
  let total = 0;

  for (const payment of payments ?? []) {
    total += payment.amount_centavos;

    byMethod.set(
      payment.method,
      (byMethod.get(payment.method) ?? 0) + payment.amount_centavos,
    );

    const day = byDay.get(payment.paid_on) ?? new Map<PaymentMethod, number>();
    day.set(
      payment.method,
      (day.get(payment.method) ?? 0) + payment.amount_centavos,
    );
    byDay.set(payment.paid_on, day);

    const booking = payment.bookings;
    const order = payment.orders;

    if (booking) {
      const lines: RevenueLine[] = (booking.booking_items ?? [])
        .filter((line) => !line.is_component)
        .map((line) => ({
          source: sourceForLine(line.line_type),
          amount_centavos: lineTotal(line),
        }));

      if (!booking.within_free_delivery_area) {
        lines.push({
          source: "delivery",
          amount_centavos: booking.delivery_fee_centavos,
        });
      }

      mix = addMix(
        mix,
        recogniseRevenue(
          payment.amount_centavos,
          documentRevenueMix(lines, booking.discount_centavos),
        ),
      );

      const customer = booking.customers;
      if (customer) {
        const current = byCustomer.get(customer.id) ?? {
          name: customer.name,
          amount: 0,
        };
        current.amount += payment.amount_centavos;
        byCustomer.set(customer.id, current);
      }
    } else if (order) {
      const lines: RevenueLine[] = (order.order_items ?? []).map((line) => ({
        source: "sale" as const,
        amount_centavos: lineTotal(line),
      }));

      mix = addMix(
        mix,
        recogniseRevenue(
          payment.amount_centavos,
          documentRevenueMix(lines, order.discount_centavos),
        ),
      );

      const customer = order.customers;
      const key = customer?.id ?? `label:${order.customer_label}`;
      const current = byCustomer.get(key) ?? {
        name: customer?.name ?? order.customer_label,
        amount: 0,
      };
      current.amount += payment.amount_centavos;
      byCustomer.set(key, current);
    }
  }

  return { mix, byMethod, byDay, byCustomer, total };
}

// ── 1. Profit & Loss ──────────────────────────────────────────
async function profitAndLoss(range: ReportRange): Promise<Body> {
  const supabase = await createClient();
  const revenue = await recognisedRevenue(range);

  // Expenses are cash-basis too: counted when actually paid.
  const { data: paidExpenses } = await supabase
    .from("expenses")
    .select("amount_centavos, category, is_paid, due_date, expense_date")
    .eq("is_paid", true)
    .gte("paid_on", range.from)
    .lte("paid_on", range.to);

  const expenseTotals = totalsByCategory(paidExpenses ?? []);
  const expenseTotal = sumCentavos(
    expenseTotals.map((entry) => entry.total_centavos),
  );
  const revenueTotal = mixTotal(revenue.mix);
  const net = revenueTotal - expenseTotal;

  const revenueRows: ReportRow[] = REVENUE_SOURCES.filter(
    (source) => revenue.mix[source] !== 0,
  ).map((source) => ({
    source: REVENUE_SOURCE_LABELS[source],
    amount: revenue.mix[source],
  }));

  return {
    highlights: [
      { label: "Revenue", value: revenueTotal, money: true, tone: "positive" },
      { label: "Expenses", value: expenseTotal, money: true, tone: "negative" },
      {
        label: "Net income",
        value: net,
        money: true,
        tone: net >= 0 ? "positive" : "negative",
      },
    ],
    sections: [
      {
        title: "Revenue — recognised on verified payment",
        emptyLabel: "No verified payments in this period.",
        columns: [
          { key: "source", label: "Source" },
          { key: "amount", label: "Amount", type: "money" },
        ],
        rows: revenueRows,
        totals: { source: "Total revenue", amount: revenueTotal },
      },
      {
        title: "Expenses — counted when paid",
        emptyLabel: "No expenses paid in this period.",
        columns: [
          { key: "category", label: "Category" },
          { key: "count", label: "Count", type: "number" },
          { key: "amount", label: "Amount", type: "money" },
        ],
        rows: expenseTotals.map((entry) => ({
          category: entry.category,
          count: entry.count,
          amount: entry.total_centavos,
        })),
        totals: { category: "Total expenses", count: null, amount: expenseTotal },
      },
      {
        columns: [
          { key: "label", label: "" },
          { key: "amount", label: "Amount", type: "money" },
        ],
        rows: [{ label: "Net income", amount: net }],
      },
    ],
  };
}

// ── 2. Daily Sales ────────────────────────────────────────────
async function dailySales(range: ReportRange): Promise<Body> {
  const revenue = await recognisedRevenue(range);
  const methods = [...revenue.byMethod.keys()].sort();

  const days = [...revenue.byDay.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );

  const rows: ReportRow[] = days.map(([day, byMethod]) => {
    const row: ReportRow = { day };
    let dayTotal = 0;

    for (const method of methods) {
      const amount = byMethod.get(method) ?? 0;
      row[method] = amount;
      dayTotal += amount;
    }

    row.total = dayTotal;
    return row;
  });

  const totals: ReportRow = { day: "Total" };
  for (const method of methods) {
    totals[method] = revenue.byMethod.get(method) ?? 0;
  }
  totals.total = revenue.total;

  return {
    highlights: [
      { label: "Collected", value: revenue.total, money: true, tone: "positive" },
      { label: "Days with takings", value: days.length },
    ],
    sections: [
      {
        emptyLabel: "No verified payments in this period.",
        columns: [
          { key: "day", label: "Day", type: "date" },
          ...methods.map((method) => ({
            key: method,
            label: PAYMENT_METHOD_LABELS[method],
            type: "money" as const,
          })),
          { key: "total", label: "Total", type: "money" as const },
        ],
        rows,
        totals,
      },
    ],
  };
}

// ── 3. Receivables (Aging) ────────────────────────────────────
async function receivables(): Promise<Body> {
  const supabase = await createClient();
  const today = todayInManila();

  // Everything still owed, whenever it was booked — an aging report
  // that only looked at the chosen range would hide the oldest debts,
  // which are the whole point of it.
  const [{ data: bookings }, { data: orders }] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "id, booking_number, event_date, discount_centavos, delivery_fee_centavos, within_free_delivery_area, downpayment_percent, status, customers(name), booking_items(quantity, unit_price_centavos, line_discount_centavos, is_component), payments(amount_centavos, status)",
      )
      .neq("status", "cancelled"),
    supabase
      .from("orders")
      .select(
        "id, order_number, sold_on, discount_centavos, customer_label, order_items(quantity, unit_price_centavos, line_discount_centavos), payments(amount_centavos, status)",
      )
      .eq("status", "completed"),
  ]);

  const rows: ReportRow[] = [];
  const aged: AgedBalance[] = [];

  for (const booking of bookings ?? []) {
    const totals = documentTotals({
      lines: (booking.booking_items ?? []).filter((line) => !line.is_component),
      within_free_delivery_area: booking.within_free_delivery_area,
      delivery_fee_centavos: booking.delivery_fee_centavos,
      discount_centavos: booking.discount_centavos,
      downpayment_percent: booking.downpayment_percent,
    });

    const paid = sumCentavos(
      (booking.payments ?? [])
        .filter((payment) => payment.status === "verified")
        .map((payment) => payment.amount_centavos),
    );

    const balance = totals.total_centavos - paid;
    if (balance <= 0) continue;

    // The balance falls due on the event day — that is when the items
    // change hands and the rest is payable.
    const bucket = receivableBucket(booking.event_date, today);
    aged.push({ balance_centavos: balance, bucket });

    rows.push({
      document: booking.booking_number,
      customer: booking.customers?.name ?? "—",
      due: booking.event_date,
      status: BOOKING_STATUS_LABELS[booking.status],
      total: totals.total_centavos,
      paid,
      balance,
      bucket,
    });
  }

  for (const order of orders ?? []) {
    const totals = orderTotals({
      lines: order.order_items ?? [],
      discount_centavos: order.discount_centavos,
    });

    const paid = sumCentavos(
      (order.payments ?? [])
        .filter((payment) => payment.status === "verified")
        .map((payment) => payment.amount_centavos),
    );

    const balance = totals.total_centavos - paid;
    if (balance <= 0) continue;

    const bucket = receivableBucket(order.sold_on, today);
    aged.push({ balance_centavos: balance, bucket });

    rows.push({
      document: order.order_number,
      customer: order.customer_label,
      due: order.sold_on,
      status: "Quick sale",
      total: totals.total_centavos,
      paid,
      balance,
      bucket,
    });
  }

  rows.sort((a, b) => String(a.due).localeCompare(String(b.due)));

  const buckets = totalsByBucket(aged);
  const outstanding = sumCentavos(aged.map((entry) => entry.balance_centavos));

  return {
    highlights: [
      {
        label: "Outstanding",
        value: outstanding,
        money: true,
        tone: outstanding > 0 ? "negative" : "positive",
      },
      { label: "Documents", value: rows.length },
    ],
    sections: [
      {
        title: "By age",
        columns: RECEIVABLE_BUCKETS.map((bucket) => ({
          key: bucket,
          label: bucket,
          type: "money" as const,
        })),
        rows: [buckets as unknown as ReportRow],
      },
      {
        title: "Outstanding balances",
        emptyLabel: "Nothing outstanding — everything is paid up.",
        columns: [
          { key: "document", label: "Document" },
          { key: "customer", label: "Customer" },
          { key: "due", label: "Due since", type: "date" },
          { key: "status", label: "Status" },
          { key: "total", label: "Total", type: "money" },
          { key: "paid", label: "Verified", type: "money" },
          { key: "balance", label: "Balance", type: "money" },
          { key: "bucket", label: "Age" },
        ],
        rows,
        totals: {
          document: "Total",
          customer: null,
          due: null,
          status: null,
          total: null,
          paid: null,
          balance: outstanding,
          bucket: null,
        },
      },
    ],
  };
}

// ── 4. Payables ───────────────────────────────────────────────
async function payables(): Promise<Body> {
  const supabase = await createClient();
  const today = todayInManila();

  const { data } = await supabase
    .from("expenses")
    .select("*, suppliers(name)")
    .eq("is_paid", false)
    .order("due_date", { ascending: true });

  const unpaid = data ?? [];
  const summary = summarisePayables(unpaid, today);

  return {
    highlights: [
      {
        label: "Outstanding",
        value: summary.outstanding_centavos,
        money: true,
        tone: "negative",
      },
      {
        label: "Overdue",
        value: summary.overdue_centavos,
        money: true,
        tone: summary.overdue_centavos > 0 ? "negative" : "neutral",
      },
      { label: "Bills", value: unpaid.length },
    ],
    sections: [
      {
        emptyLabel: "Nothing owed — every expense is settled.",
        columns: [
          { key: "due", label: "Due", type: "date" },
          { key: "payee", label: "Payee" },
          { key: "supplier", label: "Supplier" },
          { key: "category", label: "Category" },
          { key: "amount", label: "Amount", type: "money" },
          { key: "state", label: "State" },
        ],
        rows: unpaid.map((expense) => ({
          due: expense.due_date,
          payee: expense.payee,
          supplier: expense.suppliers?.name ?? "—",
          category: expense.category || "Uncategorised",
          amount: expense.amount_centavos,
          state:
            expense.due_date && expense.due_date < today ? "Overdue" : "Due",
        })),
        totals: {
          due: "Total",
          payee: null,
          supplier: null,
          category: null,
          amount: summary.outstanding_centavos,
          state: null,
        },
      },
    ],
  };
}

// ── 5. Booking Summary ────────────────────────────────────────
async function bookingSummary(range: ReportRange): Promise<Body> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("bookings")
    .select("status, event_date")
    .gte("event_date", range.from)
    .lte("event_date", range.to);

  const bookings = data ?? [];
  const counts = new Map<string, number>();
  for (const booking of bookings) {
    counts.set(booking.status, (counts.get(booking.status) ?? 0) + 1);
  }

  const cancelled = counts.get("cancelled") ?? 0;

  return {
    highlights: [
      { label: "Bookings", value: bookings.length },
      {
        label: "Cancelled",
        value: cancelled,
        tone: cancelled > 0 ? "negative" : "neutral",
      },
    ],
    sections: [
      {
        emptyLabel: "No bookings with an event date in this period.",
        columns: [
          { key: "status", label: "Status" },
          { key: "count", label: "Bookings", type: "number" },
        ],
        rows: [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([status, count]) => ({
            status:
              BOOKING_STATUS_LABELS[
                status as keyof typeof BOOKING_STATUS_LABELS
              ] ?? status,
            count,
          })),
        totals: { status: "Total", count: bookings.length },
      },
    ],
  };
}

// ── 6. Inventory & Stock ──────────────────────────────────────
async function inventory(range: ReportRange): Promise<Body> {
  const supabase = await createClient();

  const [{ data: items }, { data: bookingLines }, { data: packageLines }] =
    await Promise.all([
      supabase
        .from("catalog_items")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true }),
      // Utilisation: how often each rental item actually went out.
      supabase
        .from("booking_items")
        .select(
          "catalog_item_id, quantity, reserves_stock, bookings!inner(event_date, status)",
        )
        .eq("reserves_stock", true)
        .gte("bookings.event_date", range.from)
        .lte("bookings.event_date", range.to)
        .neq("bookings.status", "cancelled"),
      supabase
        .from("booking_items")
        .select(
          "package_id, quantity, backdrop_packages(name), bookings!inner(event_date, status, occasion)",
        )
        .eq("line_type", "package")
        .gte("bookings.event_date", range.from)
        .lte("bookings.event_date", range.to)
        .neq("bookings.status", "cancelled"),
    ]);

  const timesOut = new Map<string, { bookings: number; units: number }>();
  for (const line of bookingLines ?? []) {
    if (!line.catalog_item_id) continue;
    const current = timesOut.get(line.catalog_item_id) ?? {
      bookings: 0,
      units: 0,
    };
    current.bookings += 1;
    current.units += line.quantity;
    timesOut.set(line.catalog_item_id, current);
  }

  const packageCounts = new Map<string, { name: string; count: number }>();
  const occasionCounts = new Map<string, number>();
  for (const line of packageLines ?? []) {
    if (line.package_id) {
      const current = packageCounts.get(line.package_id) ?? {
        name: line.backdrop_packages?.name ?? "—",
        count: 0,
      };
      current.count += 1;
      packageCounts.set(line.package_id, current);
    }

    const occasion = line.bookings?.occasion?.trim() || "Not stated";
    occasionCounts.set(occasion, (occasionCounts.get(occasion) ?? 0) + 1);
  }

  const saleItems = (items ?? []).filter((item) => item.is_sale);
  const rentalItems = (items ?? []).filter((item) => item.is_rental);

  const sections: ReportSection[] = [
    {
      title: "Sale stock",
      emptyLabel: "No sale items in the catalog.",
      columns: [
        { key: "name", label: "Item" },
        { key: "stock", label: "In stock", type: "number" },
        { key: "threshold", label: "Reorder at", type: "number" },
        { key: "state", label: "State" },
      ],
      rows: saleItems.map((item) => ({
        name: item.name,
        stock: item.stock_quantity,
        threshold: item.low_stock_threshold,
        state:
          item.low_stock_threshold > 0 &&
          item.stock_quantity <= item.low_stock_threshold
            ? "Running low"
            : "OK",
      })),
    },
    {
      title: "Rental utilisation",
      emptyLabel: "No rental items went out in this period.",
      columns: [
        { key: "name", label: "Item" },
        { key: "owned", label: "Owned", type: "number" },
        { key: "bookings", label: "Bookings", type: "number" },
        { key: "units", label: "Units out", type: "number" },
        { key: "damaged", label: "Damaged", type: "number" },
      ],
      rows: rentalItems
        .map((item) => {
          const usage = timesOut.get(item.id) ?? { bookings: 0, units: 0 };
          return {
            name: item.name,
            owned: item.quantity_owned,
            bookings: usage.bookings,
            units: usage.units,
            damaged: item.damaged_quantity + item.under_repair_quantity,
          };
        })
        .sort((a, b) => Number(b.bookings) - Number(a.bookings)),
    },
    {
      title: "Backdrop package popularity",
      emptyLabel: "No packages booked in this period.",
      columns: [
        { key: "name", label: "Package" },
        { key: "count", label: "Bookings", type: "number" },
      ],
      rows: [...packageCounts.values()]
        .sort((a, b) => b.count - a.count)
        .map((entry) => ({ name: entry.name, count: entry.count })),
    },
    {
      title: "By occasion",
      emptyLabel: "No packages booked in this period.",
      columns: [
        { key: "occasion", label: "Occasion" },
        { key: "count", label: "Bookings", type: "number" },
      ],
      rows: [...occasionCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([occasion, count]) => ({ occasion, count })),
    },
  ];

  const lowStock = saleItems.filter(
    (item) =>
      item.low_stock_threshold > 0 &&
      item.stock_quantity <= item.low_stock_threshold,
  ).length;

  return {
    highlights: [
      { label: "Rental items", value: rentalItems.length },
      { label: "Sale items", value: saleItems.length },
      {
        label: "Running low",
        value: lowStock,
        tone: lowStock > 0 ? "negative" : "positive",
      },
    ],
    sections,
  };
}

// ── 7. Customer Report ────────────────────────────────────────
async function customers(range: ReportRange): Promise<Body> {
  const supabase = await createClient();
  const revenue = await recognisedRevenue(range);

  // Damage incidents come off the booking lines rather than the audit
  // trail, so the figures reconcile with what was charged.
  const { data: damaged } = await supabase
    .from("booking_items")
    .select(
      "description, damaged_quantity, lost_quantity, bookings!inner(booking_number, event_date, customers(name))",
    )
    .or("damaged_quantity.gt.0,lost_quantity.gt.0")
    .gte("bookings.event_date", range.from)
    .lte("bookings.event_date", range.to);

  const top = [...revenue.byCustomer.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 25);

  return {
    highlights: [
      { label: "Paying customers", value: revenue.byCustomer.size },
      {
        label: "Collected",
        value: revenue.total,
        money: true,
        tone: "positive",
      },
    ],
    sections: [
      {
        title: "Top customers by payments received",
        emptyLabel: "No verified payments in this period.",
        columns: [
          { key: "customer", label: "Customer" },
          { key: "amount", label: "Paid", type: "money" },
        ],
        rows: top.map((entry) => ({
          customer: entry.name,
          amount: entry.amount,
        })),
        totals: { customer: "Total", amount: revenue.total },
      },
      {
        title: "Damage and loss incidents",
        emptyLabel: "No damage or loss recorded in this period.",
        columns: [
          { key: "customer", label: "Customer" },
          { key: "booking", label: "Booking" },
          { key: "item", label: "Item" },
          { key: "damaged", label: "Damaged", type: "number" },
          { key: "lost", label: "Lost", type: "number" },
        ],
        rows: (damaged ?? []).map((line) => ({
          customer: line.bookings?.customers?.name ?? "—",
          booking: line.bookings?.booking_number ?? "—",
          item: line.description,
          damaged: line.damaged_quantity,
          lost: line.lost_quantity,
        })),
      },
    ],
  };
}

// ── 8. Expense Report ─────────────────────────────────────────
async function expenses(range: ReportRange): Promise<Body> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("expenses")
    .select("*, suppliers(name)")
    .gte("expense_date", range.from)
    .lte("expense_date", range.to)
    .order("expense_date", { ascending: true });

  const rows = data ?? [];
  const byCategory = totalsByCategory(rows);
  const total = sumCentavos(rows.map((expense) => expense.amount_centavos));

  const bySupplier = new Map<string, number>();
  for (const expense of rows) {
    const key = expense.suppliers?.name ?? (expense.payee || "—");
    bySupplier.set(key, (bySupplier.get(key) ?? 0) + expense.amount_centavos);
  }

  return {
    highlights: [
      { label: "Total spent", value: total, money: true, tone: "negative" },
      { label: "Entries", value: rows.length },
    ],
    sections: [
      {
        title: "By category",
        emptyLabel: "No expenses in this period.",
        columns: [
          { key: "category", label: "Category" },
          { key: "count", label: "Entries", type: "number" },
          { key: "amount", label: "Amount", type: "money" },
        ],
        rows: byCategory.map((entry) => ({
          category: entry.category,
          count: entry.count,
          amount: entry.total_centavos,
        })),
        totals: { category: "Total", count: rows.length, amount: total },
      },
      {
        title: "By supplier or payee",
        emptyLabel: "No expenses in this period.",
        columns: [
          { key: "supplier", label: "Supplier / payee" },
          { key: "amount", label: "Amount", type: "money" },
        ],
        rows: [...bySupplier.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([supplier, amount]) => ({ supplier, amount })),
      },
      {
        title: "Every entry",
        emptyLabel: "No expenses in this period.",
        columns: [
          { key: "date", label: "Date", type: "date" },
          { key: "payee", label: "Payee" },
          { key: "category", label: "Category" },
          { key: "method", label: "Method" },
          { key: "reference", label: "Reference" },
          { key: "amount", label: "Amount", type: "money" },
          { key: "paid", label: "Paid" },
        ],
        rows: rows.map((expense) => ({
          date: expense.expense_date,
          payee: expense.payee,
          category: expense.category || "Uncategorised",
          method: expense.method
            ? PAYMENT_METHOD_LABELS[expense.method]
            : "—",
          reference: expense.reference_number || "—",
          amount: expense.amount_centavos,
          paid: expense.is_paid ? "Yes" : "No",
        })),
        totals: {
          date: "Total",
          payee: null,
          category: null,
          method: null,
          reference: null,
          amount: total,
          paid: null,
        },
      },
    ],
  };
}
