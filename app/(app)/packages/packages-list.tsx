"use client";

import { OCCASION_LABELS } from "@/lib/catalog/packages";
import { Card, CardHeader } from "@/components/ui/card";
import {
  ListSearch,
  useFiltered,
  useListSearch,
} from "@/components/ui/list-search";
import { PackageRow } from "./package-manager";
import type { ComponentOption, PackageWithComponents } from "./page";

/** Backdrop packages with inline search (Spec 4.2). */
export function PackagesList({
  packages,
  options,
  canManage,
}: {
  packages: PackageWithComponents[];
  options: ComponentOption[];
  canManage: boolean;
}) {
  const [query, setQuery] = useListSearch();

  const visible = useFiltered(packages, query, (pkg) => [
    pkg.name,
    pkg.description,
    // Occasion labels and component names, so "wedding" or "fairy
    // lights" both find the package that uses them.
    ...pkg.occasion_tags.map(
      (tag) => OCCASION_LABELS[tag as keyof typeof OCCASION_LABELS] ?? tag,
    ),
    ...pkg.components.map((component) => component.name),
  ]);

  return (
    <div className="space-y-4">
      <ListSearch
        id="package-search"
        label="Search backdrop packages"
        placeholder="Search name, occasion, or component"
        value={query}
        onChange={setQuery}
        resultCount={visible.length}
        totalCount={packages.length}
        noun="packages"
      />

      <Card>
        <CardHeader
          title="Packages"
          description={`${packages.length} total. The bundle price is what the customer pays — it need not equal the components.`}
        />
        {visible.length > 0 ? (
          <ul>
            {visible.map((pkg) => (
              <PackageRow
                key={pkg.id}
                pkg={pkg}
                options={options}
                canManage={canManage}
              />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-ink-500 sm:px-6">
            {packages.length === 0
              ? `No backdrop packages yet.${canManage ? " Add your first one above." : ""}`
              : `No package matches “${query.trim()}”.`}
          </p>
        )}
      </Card>
    </div>
  );
}
