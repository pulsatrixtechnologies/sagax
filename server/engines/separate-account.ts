// A leaf on purpose (#1381 madge ratchet): engine-credentials.ts reads it,
// and principal-engine-logins.ts reaches the Grok driver, which reaches
// config.ts back through the usage ledger.

/** 2026-11-06 (#2373): an account added next to a driver's first one
 * (Providers > Add account: `claude-<uuid>`, `chatgpt-<uuid>`,
 * `antigravity-<uuid>`) keeps its own sign-in per person. Every other
 * instance of a driver shares the person's first sign-in, the folder it has
 * always used, so nobody signed in before loses it. */
const SEPARATE_ACCOUNT = /^[a-z][\w.]*-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function separateAccountInstance(instanceId: string | null | undefined): instanceId is string {
  return typeof instanceId === "string" && SEPARATE_ACCOUNT.test(instanceId);
}
