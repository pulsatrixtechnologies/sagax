// Per-turn grant for the desktop-model proxy. The inject base URL is shared
// by every harness, so the person cannot be encoded in it. The grant rides
// in the API key for this turn only. This module does not import local-inject.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

const TTL_MS = 6 * 60 * 60 * 1000;
const CAP = 4_000;

const store = new AsyncLocalStorage<{ person: string; token: string }>();
const grants = new Map<string, { person: string; expires: number }>();

function prune(now: number): void {
  if (grants.size < CAP) return;
  for (const [token, row] of grants) {
    if (row.expires <= now || grants.size >= CAP) grants.delete(token);
    if (grants.size < CAP) break;
  }
}

/** Run `fn` as `person`. A missing person runs with no grant. */
export function withDesktopModelPerson<T>(person: string | null | undefined, fn: () => T): T {
  const key = person?.trim().toLowerCase();
  if (!key) return fn();
  const now = Date.now();
  prune(now);
  const token = randomBytes(32).toString("hex");
  grants.set(token, { person: key, expires: now + TTL_MS });
  return store.run({ person: key, token }, fn);
}

/** The API key the harness should send to the loopback proxy, or "desktop" when this turn has no grant. */
export function desktopModelApiKey(): string {
  return store.getStore()?.token ?? "desktop";
}

/** Person bound to a bearer or x-api-key token. Unknown and expired tokens are refused. */
export function personForDesktopGrant(token: string | undefined): string | null {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = grants.get(token);
  if (!row || row.expires <= Date.now()) {
    if (row) grants.delete(token);
    return null;
  }
  return row.person;
}
