import type { Metadata } from "next";
import Link from "next/link";

import { requirePermission } from "@/lib/auth/dal";
import { Banner } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import { loadBuilderData } from "../builder-data";
import { QuotationBuilder } from "../quotation-builder";

export const metadata: Metadata = { title: "New quotation" };

export default async function NewQuotationPage() {
  await requirePermission("quotations.manage");

  const { customers, options, defaults } = await loadBuilderData();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          New quotation
        </h1>
        <p className="mt-1 text-sm text-ink-600">
          Saved as a draft. Download the PDF and mark it sent once the customer
          has it.
        </p>
      </header>

      {customers.length === 0 ? (
        <Banner tone="warning">
          <span className="block">
            There are no active customers yet, and a quotation has to be for
            someone.
          </span>
          <Link
            href="/customers"
            className={`${buttonClasses("secondary", "sm")} mt-2`}
          >
            Add a customer first
          </Link>
        </Banner>
      ) : (
        <QuotationBuilder
          mode="create"
          customers={customers}
          options={options}
          defaults={defaults}
        />
      )}
    </div>
  );
}
