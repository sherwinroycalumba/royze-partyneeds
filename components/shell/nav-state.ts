"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Remembering which nav groups a person keeps open.
 *
 * Backed by `localStorage` through `useSyncExternalStore` rather than
 * a state-plus-effect pair: the server has no localStorage, and
 * seeding state from an effect either flashes the wrong nav or trips
 * the hydration check. `getServerSnapshot` gives the server a stable
 * default and React reconciles once on the client.
 *
 * Keyed by user, because a shared shop tablet signs several people in
 * and one person's collapsed Finance section should not become
 * everybody's.
 */

const EMPTY = "{}";

/** Local writes have to notify this tab; `storage` only fires on others. */
const listeners = new Set<() => void>();

function storageKeyFor(userKey: string): string {
  return `royze.nav.groups.${userKey}`;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readRaw(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? EMPTY;
  } catch {
    // Private browsing, a locked-down device, a full quota — none of
    // which is worth breaking navigation over.
    return EMPTY;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Same again: the nav still works, it just forgets.
  }
  for (const listener of listeners) listener();
}

export type OpenGroups = Record<string, boolean>;

export function useOpenGroups(
  userKey: string,
): [OpenGroups, (groupId: string, open: boolean) => void] {
  const key = storageKeyFor(userKey);

  // Returns the raw string, which is stable between reads — parsing
  // here would hand `useSyncExternalStore` a new object every time and
  // spin forever.
  const raw = useSyncExternalStore(
    subscribe,
    useCallback(() => readRaw(key), [key]),
    () => EMPTY,
  );

  const groups = useMemo<OpenGroups>(() => {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return {};
      return parsed as OpenGroups;
    } catch {
      return {};
    }
  }, [raw]);

  const setGroup = useCallback(
    (groupId: string, open: boolean) => {
      writeRaw(key, JSON.stringify({ ...groups, [groupId]: open }));
    },
    [key, groups],
  );

  return [groups, setGroup];
}
