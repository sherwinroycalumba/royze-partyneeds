"use client";

import {
  actionLabel,
  AUDIT_DOMAIN_LABELS,
  domainOf,
  isNotable,
} from "@/lib/audit-log";
import { formatDateTime } from "@/lib/date";
import { Badge, Card, CardHeader } from "@/components/ui/card";
import {
  ListSearch,
  useFiltered,
  useListSearch,
} from "@/components/ui/list-search";

export type AuditRow = {
  id: number;
  actor_name: string;
  action: string;
  entity_type: string;
  summary: string;
  created_at: string;
};

/**
 * The audit trail, read (Spec 5).
 *
 * Rows are append-only and there is no drill-down: an entry is already
 * a sentence about what happened, and the details column is a JSON
 * diff that would be noise on screen. What the reader needs is to find
 * the right sentence, so the search matches the summary as well as the
 * actor.
 */
export function AuditList({
  entries,
  truncated,
}: {
  entries: AuditRow[];
  truncated: boolean;
}) {
  const [query, setQuery] = useListSearch();

  const visible = useFiltered(entries, query, (entry) => [
    entry.summary,
    entry.actor_name,
    entry.action,
    entry.entity_type,
  ]);

  return (
    <div className="space-y-4">
      <ListSearch
        id="audit-search"
        label="Search the audit trail"
        placeholder="Search what happened, or who did it"
        value={query}
        onChange={setQuery}
        resultCount={visible.length}
        totalCount={entries.length}
        noun="entries"
      />

      {truncated && (
        <p className="text-xs text-ink-500">
          Showing the most recent {entries.length}. Narrow the date range to
          reach further back.
        </p>
      )}

      <Card>
        <CardHeader title="Activity" description={`${entries.length} shown.`} />

        {visible.length > 0 ? (
          <ul className="divide-y divide-ink-200">
            {visible.map((entry) => {
              const domain = domainOf(entry.action);
              const notable = isNotable(entry.action);

              return (
                <li key={entry.id} className="px-4 py-3 sm:px-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="font-medium text-ink-900">{entry.summary}</p>
                    <span className="text-xs text-ink-500">
                      {formatDateTime(entry.created_at)}
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-sm text-ink-600">
                      {entry.actor_name}
                    </span>
                    {domain && (
                      <Badge tone="neutral">
                        {AUDIT_DOMAIN_LABELS[domain]}
                      </Badge>
                    )}
                    <Badge tone={notable ? "warning" : "neutral"}>
                      {actionLabel(entry.action)}
                    </Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-ink-500 sm:px-6">
            {entries.length === 0
              ? "Nothing recorded for these filters."
              : `Nothing matches “${query.trim()}”.`}
          </p>
        )}
      </Card>
    </div>
  );
}
