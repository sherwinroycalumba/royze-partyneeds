"use client";

import { useActionState, useState } from "react";

import {
  createUserAction,
  resetUserPasswordAction,
  setUserActiveAction,
  updateUserAction,
  type UserFormState,
} from "@/lib/users/actions";
import { ALL_ROLES, ROLE_LABELS } from "@/lib/auth/permissions";
import type { Profile, UserRole } from "@/lib/supabase/database.types";
import { formatDate } from "@/lib/date";
import { Badge, Banner, Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Field, Select, TextInput } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";

/** One-time credential display — the password is never retrievable later. */
function TemporaryPasswordNotice({ password }: { password: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-lg border border-warning-100 bg-warning-50 p-3">
      <p className="text-sm font-semibold text-warning-700">
        Temporary password — shown once
      </p>
      <p className="mt-1 text-xs text-warning-700">
        Send this to the staff member. They must change it when they sign in.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 rounded-md border border-warning-100 bg-surface px-3 py-2 font-mono text-sm text-ink-900">
          {password}
        </code>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(password).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

function RoleSelect({
  id,
  defaultValue,
  onChange,
}: {
  id: string;
  defaultValue: UserRole;
  onChange: (role: UserRole) => void;
}) {
  return (
    <Select
      id={id}
      name="role"
      defaultValue={defaultValue}
      onChange={(event) => onChange(event.target.value as UserRole)}
      required
    >
      {ALL_ROLES.map((role) => (
        <option key={role} value={role}>
          {ROLE_LABELS[role]}
        </option>
      ))}
    </Select>
  );
}

/** The catalog_manager flag only means anything for Booking Staff. */
function CatalogManagerToggle({
  id,
  defaultChecked,
  visible,
}: {
  id: string;
  defaultChecked: boolean;
  visible: boolean;
}) {
  if (!visible) return null;

  return (
    <label
      htmlFor={id}
      className="flex items-start gap-2.5 rounded-lg border border-ink-200 bg-ink-50/60 p-3"
    >
      <input
        id={id}
        name="catalog_manager"
        type="checkbox"
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600"
      />
      <span>
        <span className="block text-sm font-medium text-ink-800">
          Can manage the price catalog
        </span>
        <span className="block text-xs text-ink-500">
          Lets this staff member add and edit items, packages, and prices.
        </span>
      </span>
    </label>
  );
}

// ── Create ────────────────────────────────────────────────────
export function CreateUserPanel() {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<UserRole>("booking_staff");
  const [state, formAction] = useActionState<UserFormState, FormData>(
    createUserAction,
    {},
  );

  if (!open && !state.temporaryPassword) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        + Add staff account
      </Button>
    );
  }

  return (
    <Card>
      <form action={formAction}>
        <CardHeader
          title="New staff account"
          description="The account is created with a temporary password shown once after saving."
        />
        <CardBody className="space-y-4">
          {state.error && <Banner tone="error">{state.error}</Banner>}
          {state.success && <Banner tone="success">{state.success}</Banner>}
          {state.temporaryPassword && (
            <TemporaryPasswordNotice password={state.temporaryPassword} />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="new_full_name" required>
              <TextInput
                id="new_full_name"
                name="full_name"
                required
                autoComplete="off"
              />
            </Field>

            <Field label="Email" htmlFor="new_email" required>
              <TextInput
                id="new_email"
                name="email"
                type="email"
                required
                autoCapitalize="none"
                autoComplete="off"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" htmlFor="new_phone">
              <TextInput id="new_phone" name="phone" inputMode="tel" />
            </Field>

            <Field label="Role" htmlFor="new_role" required>
              <RoleSelect
                id="new_role"
                defaultValue="booking_staff"
                onChange={setRole}
              />
            </Field>
          </div>

          <CatalogManagerToggle
            id="new_catalog_manager"
            defaultChecked={false}
            visible={role === "booking_staff"}
          />
        </CardBody>
        <CardFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          <SubmitButton pendingLabel="Creating…">Create account</SubmitButton>
        </CardFooter>
      </form>
    </Card>
  );
}

// ── Row ───────────────────────────────────────────────────────
export function UserRow({
  user,
  isSelf,
}: {
  user: Profile;
  isSelf: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="border-b border-ink-200 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-ink-900">{user.full_name}</p>
            {isSelf && <Badge tone="brand">You</Badge>}
            {!user.is_active && <Badge tone="danger">Deactivated</Badge>}
            {user.must_change_password && user.is_active && (
              <Badge tone="warning">Password change pending</Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-ink-600">{user.email}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
            <span className="font-medium text-ink-700">
              {ROLE_LABELS[user.role]}
            </span>
            {user.role === "booking_staff" && user.catalog_manager && (
              <span>Catalog manager</span>
            )}
            {user.phone && <span>{user.phone}</span>}
            <span>Added {formatDate(user.created_at)}</span>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setEditing((value) => !value)}
            aria-expanded={editing}
          >
            {editing ? "Cancel" : "Edit"}
          </Button>
          <ResetPasswordButton userId={user.id} />
          <ActiveToggleButton
            userId={user.id}
            isActive={user.is_active}
            disabled={isSelf}
          />
        </div>
      </div>

      {editing && (
        <div className="border-t border-ink-200 bg-ink-50/50 px-4 py-4 sm:px-6">
          <EditUserForm user={user} onDone={() => setEditing(false)} />
        </div>
      )}
    </li>
  );
}

function EditUserForm({
  user,
  onDone,
}: {
  user: Profile;
  onDone: () => void;
}) {
  const [role, setRole] = useState<UserRole>(user.role);
  const [state, formAction] = useActionState<UserFormState, FormData>(
    updateUserAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="user_id" value={user.id} />

      {state.error && <Banner tone="error">{state.error}</Banner>}
      {state.success && <Banner tone="success">{state.success}</Banner>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor={`name-${user.id}`} required>
          <TextInput
            id={`name-${user.id}`}
            name="full_name"
            defaultValue={user.full_name}
            required
          />
        </Field>

        <Field label="Phone" htmlFor={`phone-${user.id}`}>
          <TextInput
            id={`phone-${user.id}`}
            name="phone"
            inputMode="tel"
            defaultValue={user.phone ?? ""}
          />
        </Field>
      </div>

      <Field label="Role" htmlFor={`role-${user.id}`} required>
        <RoleSelect
          id={`role-${user.id}`}
          defaultValue={user.role}
          onChange={setRole}
        />
      </Field>

      <CatalogManagerToggle
        id={`catalog-${user.id}`}
        defaultChecked={user.catalog_manager}
        visible={role === "booking_staff"}
      />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Done
        </Button>
        <SubmitButton size="sm" pendingLabel="Saving…">
          Save
        </SubmitButton>
      </div>
    </form>
  );
}

function ResetPasswordButton({ userId }: { userId: string }) {
  const [state, formAction] = useActionState<UserFormState, FormData>(
    resetUserPasswordAction,
    {},
  );

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="user_id" value={userId} />
        <SubmitButton variant="secondary" size="sm" pendingLabel="Resetting…">
          Reset password
        </SubmitButton>
      </form>

      {state.error && (
        <p className="mt-1 text-xs font-medium text-danger-600">{state.error}</p>
      )}
      {state.temporaryPassword && (
        <div className="mt-2 w-64">
          <TemporaryPasswordNotice password={state.temporaryPassword} />
        </div>
      )}
    </div>
  );
}

function ActiveToggleButton({
  userId,
  isActive,
  disabled,
}: {
  userId: string;
  isActive: boolean;
  disabled: boolean;
}) {
  const [state, formAction] = useActionState<UserFormState, FormData>(
    setUserActiveAction,
    {},
  );

  if (disabled) return null;

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="user_id" value={userId} />
        <input type="hidden" name="activate" value={String(!isActive)} />
        <SubmitButton
          variant={isActive ? "danger" : "secondary"}
          size="sm"
          pendingLabel="Saving…"
        >
          {isActive ? "Deactivate" : "Reactivate"}
        </SubmitButton>
      </form>

      {state.error && (
        <p className="mt-1 max-w-56 text-xs font-medium text-danger-600">
          {state.error}
        </p>
      )}
    </div>
  );
}
