// Single-flight OAuth refresh for a Claude login home (#1768).
//
// On an organization server every Claude process of one person shares
// `principals/<pid>/claude` and one rotating refresh token. Claude Code
// refreshes that token itself; two processes that refresh at once leave one
// with a revoked grant, so the turn fails with authentication_failed and
// Sagax asks the member to reconnect. Every renew of a Claude subscription
// home goes through this module: waiters share one flight, and callers that
// keep warm processes retire them before the CLI rewrites the credentials.
import { canonicalPath } from "../drivers/device-auth.ts";
import {
  readSubscriptionAccess,
  renewWithCli,
  type RenewInput,
  type SubscriptionAccess,
} from "../cloud-agents/subscription-access.ts";

/** Renew when less than this life is left, matching the cloud-agent depositor. */
export const CLAUDE_RENEW_MARGIN_MS = 15 * 60_000;

export type ClaudeSubscriptionFresh =
  | { ok: true; renewed: boolean; expiresAt: number | null }
  | { ok: false; reason: "missing" | "expired" };

export interface EnsureClaudeSubscriptionFreshInput {
  loginDir: string;
  cli: string;
  environment: Record<string, string | undefined>;
  /** Force a CLI renew even when the access token still has margin. */
  force?: boolean;
  now?: () => number;
  marginMs?: number;
  timeoutMs?: number;
  read?: (loginDir: string) => Promise<SubscriptionAccess | null>;
  renew?: (input: RenewInput) => Promise<void>;
  /** Fired under the flight before the CLI renews: close warm processes that
   * still hold the old token so they cannot race the rotation. */
  beforeRenew?: (loginDir: string) => void | Promise<void>;
  /** Fired after a renew that left a usable access token. */
  onRenewed?: (loginDir: string) => void;
}

type Flight = Promise<ClaudeSubscriptionFresh>;

const flights = new Map<string, Flight>();
const retireHooks = new Set<(loginDir: string) => void>();
const renewedHooks = new Set<(loginDir: string) => void>();

/** Canonical key so two spellings of one login home share one flight. */
export function claudeSubscriptionHomeKey(loginDir: string): string {
  return canonicalPath(loginDir);
}

/** Register a hook that retires warm Claude processes for a login home.
 * Fires under the flight before the CLI rewrites credentials. Returns an
 * unregister function (call from dispose). */
export function onClaudeSubscriptionRenew(hook: (loginDir: string) => void): () => void {
  retireHooks.add(hook);
  return () => { retireHooks.delete(hook); };
}

/** Register a hook that runs after a renew left a usable access token
 * (clear an expired marker, refresh UI). Returns an unregister function. */
export function onClaudeSubscriptionRenewed(hook: (loginDir: string) => void): () => void {
  renewedHooks.add(hook);
  return () => { renewedHooks.delete(hook); };
}

function notifyRetire(loginDir: string): void {
  const key = claudeSubscriptionHomeKey(loginDir);
  for (const hook of retireHooks) {
    try { hook(key); } catch { /* a broken retire must not block the renew */ }
  }
}

function notifyRenewed(loginDir: string): void {
  const key = claudeSubscriptionHomeKey(loginDir);
  for (const hook of renewedHooks) {
    try { hook(key); } catch { /* a broken listener must not undo the renew */ }
  }
}

function stillFresh(access: SubscriptionAccess | null, now: number, marginMs: number): access is SubscriptionAccess {
  if (!access) return false;
  return access.expiresAt === null || access.expiresAt - now >= marginMs;
}

function usable(access: SubscriptionAccess | null, now: number): access is SubscriptionAccess {
  if (!access) return false;
  return access.expiresAt === null || access.expiresAt > now + 60_000;
}

/** Ensure the Claude login home has a usable access token. Concurrent callers
 * for the same home share one CLI renew. */
export function ensureClaudeSubscriptionFresh(input: EnsureClaudeSubscriptionFreshInput): Promise<ClaudeSubscriptionFresh> {
  const key = claudeSubscriptionHomeKey(input.loginDir);
  const existing = flights.get(key);
  if (existing) {
    return existing.then(async (result) => {
      if (!input.force) return result;
      if (result.ok && result.renewed) return result;
      // The in-flight pass finished without a forced renew: run our own.
      return ensureClaudeSubscriptionFresh({ ...input, force: true });
    });
  }

  const flight: Flight = (async (): Promise<ClaudeSubscriptionFresh> => {
    const now = input.now?.() ?? Date.now();
    const marginMs = input.marginMs ?? CLAUDE_RENEW_MARGIN_MS;
    const read = input.read ?? ((dir: string) => readSubscriptionAccess("claude-code", dir));
    let access = await read(input.loginDir);
    if (!input.force && stillFresh(access, now, marginMs)) {
      return { ok: true, renewed: false, expiresAt: access.expiresAt };
    }

    await input.beforeRenew?.(input.loginDir);
    notifyRetire(input.loginDir);

    const renew = input.renew ?? renewWithCli;
    await renew({
      engine: "claude-code",
      cli: input.cli,
      loginDir: input.loginDir,
      environment: input.environment,
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    }).catch(() => {});

    access = await read(input.loginDir);
    if (usable(access, now)) {
      input.onRenewed?.(input.loginDir);
      notifyRenewed(input.loginDir);
      return { ok: true, renewed: true, expiresAt: access.expiresAt };
    }
    return { ok: false, reason: access ? "expired" : "missing" };
  })().finally(() => {
    if (flights.get(key) === flight) flights.delete(key);
  });

  flights.set(key, flight);
  return flight;
}

/** Test helper: drop in-flight renews between cases. */
export function resetClaudeSubscriptionRefreshForTests(): void {
  flights.clear();
  retireHooks.clear();
  renewedHooks.clear();
}
