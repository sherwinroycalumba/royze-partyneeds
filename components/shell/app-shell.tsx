"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavItem } from "@/lib/nav";
import { signOutAction } from "@/lib/auth/actions";
import { BrandLock } from "@/components/brand/logo";
import { NavIcon } from "./icons";

export type ShellUser = {
  name: string;
  email: string;
  roleLabel: string;
};

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function AppShell({
  items,
  user,
  businessName,
  logoUrl,
  children,
}: {
  items: NavItem[];
  user: ShellUser;
  businessName: string;
  logoUrl: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const primary = items.filter((item) => item.primary).slice(0, 4);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* ── Desktop sidebar ─────────────────────────────────── */}
      <aside className="hidden w-64 shrink-0 border-r border-ink-200 bg-surface lg:flex lg:flex-col">
        <div className="border-b border-ink-200 px-5 py-4">
          <BrandLock businessName={businessName} logoUrl={logoUrl} />
        </div>

        <nav className="flex-1 space-y-1 p-3" aria-label="Main">
          {items.map((item) => (
            <SidebarLink
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
            />
          ))}
        </nav>

        <UserPanel user={user} />
      </aside>

      {/* ── Mobile header ───────────────────────────────────── */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-200 bg-surface px-4 py-3 lg:hidden">
        <BrandLock businessName={businessName} logoUrl={logoUrl} compact />
        <span className="min-w-0 flex-1 truncate px-3 text-sm font-semibold text-ink-900">
          {businessName}
        </span>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="-mr-1 inline-flex size-10 items-center justify-center rounded-lg text-ink-700 hover:bg-ink-100"
          aria-label="Open menu"
          aria-expanded={menuOpen}
        >
          <svg
            className="size-6"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.7}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
            />
          </svg>
        </button>
      </header>

      {/* ── Mobile slide-over menu ──────────────────────────── */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-ink-900/40"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-y-0 right-0 flex w-72 max-w-[85%] flex-col bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
              <span className="text-sm font-semibold text-ink-900">Menu</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="inline-flex size-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100"
                aria-label="Close menu"
              >
                <svg
                  className="size-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.8}
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Main">
              {items.map((item) => (
                <SidebarLink
                  key={item.href}
                  item={item}
                  active={isActive(pathname, item.href)}
                  onNavigate={() => setMenuOpen(false)}
                />
              ))}
            </nav>

            <UserPanel user={user} />
          </div>
        </div>
      )}

      {/* ── Content ─────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="fade-in flex-1 px-4 py-5 pb-24 sm:px-6 lg:px-8 lg:pb-8">
          {children}
        </main>
      </div>

      {/* ── Mobile bottom bar ───────────────────────────────── */}
      {primary.length > 1 && (
        <nav
          className="fixed inset-x-0 bottom-0 z-30 flex border-t border-ink-200 bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
          aria-label="Quick navigation"
        >
          {primary.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
                  active ? "text-brand-600" : "text-ink-500"
                }`}
              >
                <NavIcon name={item.icon} className="size-6" />
                {item.shortLabel ?? item.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}

function SidebarLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  // Open by default whenever the user is inside the group, so the
  // section they are editing is always in view. An explicit toggle
  // overrides that until they navigate in or out of the group, which
  // clears it — otherwise a collapse would stick across navigations.
  const [override, setOverride] = useState<boolean | null>(null);
  const [wasActive, setWasActive] = useState(active);

  if (wasActive !== active) {
    setWasActive(active);
    setOverride(null);
  }

  const expanded = override ?? active;

  const parent = (
    <Link
      href={item.href}
      onClick={onNavigate}
      // The parent of an open group is a route to its first section,
      // not the current page — only leaves claim aria-current.
      aria-current={active && !item.children ? "page" : undefined}
      className={`flex min-h-11 flex-1 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
        active
          ? "bg-brand-50 text-brand-700"
          : "text-ink-700 hover:bg-ink-100 hover:text-ink-900"
      }`}
    >
      <NavIcon name={item.icon} />
      {item.label}
    </Link>
  );

  if (!item.children || item.children.length === 0) {
    return parent;
  }

  return (
    <div>
      <div className="flex items-center gap-1">
        {parent}
        <button
          type="button"
          onClick={() => setOverride(!expanded)}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${item.label}`}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800"
        >
          <svg
            className={`size-4 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
          </svg>
        </button>
      </div>

      {expanded && (
        <ul className="mt-1 space-y-0.5 border-l border-ink-200 pl-3 ml-5">
          {item.children.map((child) => {
            const childActive = pathname === child.href;
            return (
              <li key={child.href}>
                <Link
                  href={child.href}
                  onClick={onNavigate}
                  aria-current={childActive ? "page" : undefined}
                  className={`flex min-h-10 items-center rounded-lg px-3 text-sm transition-colors ${
                    childActive
                      ? "bg-brand-50 font-semibold text-brand-700"
                      : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"
                  }`}
                >
                  {child.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function UserPanel({ user }: { user: ShellUser }) {
  return (
    <div className="border-t border-ink-200 p-3">
      <div className="flex items-center gap-3 px-2 py-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
          {initials(user.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-900">
            {user.name}
          </p>
          <p className="truncate text-xs text-ink-500">{user.roleLabel}</p>
        </div>
      </div>

      <form action={signOutAction}>
        <button
          type="submit"
          className="mt-1 flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
        >
          <svg
            className="size-5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.7}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75"
            />
          </svg>
          Sign out
        </button>
      </form>
    </div>
  );
}
