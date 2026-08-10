import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/dal";

/**
 * Append-only audit trail (Spec 5).
 *
 * Writes as the acting user so the RLS insert policy applies. Failures
 * are swallowed and logged: an audit write must never roll back the
 * business action that succeeded.
 */
export type AuditInput = {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  details?: Record<string, unknown>;
};

export async function logAudit(input: AuditInput): Promise<void> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return;

    const supabase = await createClient();
    const { error } = await supabase.from("audit_log").insert({
      actor_id: profile.id,
      actor_name: profile.full_name || profile.email,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      summary: input.summary ?? "",
      details: (input.details ?? {}) as never,
    });

    if (error) {
      console.error("[audit] failed to write entry", input.action, error.message);
    }
  } catch (error) {
    console.error("[audit] unexpected failure", error);
  }
}

/**
 * Builds a `{ field: { from, to } }` diff for audit details, so the log
 * records what actually changed rather than the whole row.
 */
export function diffChanges<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const [key, next] of Object.entries(after)) {
    const previous = before[key];
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      changes[key] = { from: previous ?? null, to: next ?? null };
    }
  }

  return changes;
}
