import { useSyncExternalStore } from "react";

const KEY = "opsdesk.userId";
const DEFAULT = "u1";
const listeners = new Set<() => void>();

export function getCurrentUserId(): string {
  if (typeof window === "undefined") return DEFAULT;
  return window.localStorage.getItem(KEY) ?? DEFAULT;
}

export function setCurrentUserId(id: string) {
  window.localStorage.setItem(KEY, id);
  listeners.forEach((l) => l());
}

export function useCurrentUserId(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getCurrentUserId,
    () => DEFAULT,
  );
}

export const newKey = () => crypto.randomUUID();
