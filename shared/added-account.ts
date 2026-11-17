// Which accounts of a provider a person can remove (#4415, #4426, Providers >
// a provider > Accounts: "I should be able to delete accounts"). Any account,
// the first one included, while the provider keeps another one; the only
// account is where to sign in, so there is nothing to remove. `addedAccount`
// stays the older "added beside the first" test (#4435: ownership and
// sign-in folders). The server (DELETE /api/instances/:id, DELETE
// /api/me/engines/:id) and the page read `removableAccount`.

/** 2026-11-06 (#2373): an account added next to a driver's first one
 * (Providers > Add account: `claude-<uuid>`, `chatgpt-<uuid>`,
 * `antigravity-<uuid>`) keeps its own sign-in per person. Every other
 * instance of a driver shares the person's first sign-in, the folder it has
 * always used, so nobody signed in before loses it. */
const SEPARATE_ACCOUNT = /^[a-z][\w.]*-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function separateAccountInstance(instanceId: string | null | undefined): instanceId is string {
  return typeof instanceId === "string" && SEPARATE_ACCOUNT.test(instanceId);
}

/** An account added beside the provider's first one: one with its own
 * sign-in (`<driver>-<uuid>`), or a Claude account other than the default
 * `claude` (named accounts from before #2373 keep their own folder too).
 * A company account is managed in desktop Settings, never removed here. */
export function addedAccount(instanceId: string, driver: string): boolean {
  if (instanceId.startsWith("company.")) return false;
  if (separateAccountInstance(instanceId)) return true;
  return driver === "claudeAgent" && instanceId !== "claude";
}

/** #4435: the provider's first account an added one sits beside (the id
 * before its `-<uuid>`: `claude`, `chatgpt`, `antigravity`; `claude` for a
 * named Claude account from before #2373). Undefined for any other engine.
 * A person's own added account follows that first account in the
 * organization's list of allowed engines. */
export function providerFirstAccount(instanceId: string, driver: string): string | undefined {
  if (!addedAccount(instanceId, driver)) return undefined;
  return separateAccountInstance(instanceId) ? instanceId.slice(0, -37) : "claude";
}

const companyAccount = (instanceId: string) => instanceId.startsWith("company.");

/** Whether an account can be removed: never a company account (managed in
 * desktop Settings), else whenever its provider keeps another account.
 * `accounts` lists the provider's accounts; this one may be among them. */
export function removableAccount(instanceId: string, accounts: readonly string[]): boolean {
  return !companyAccount(instanceId) && accounts.some((id) => id !== instanceId && !companyAccount(id));
}

/** Why the server refused: the page offers no Remove there. */
export const ONLY_ACCOUNT_ERROR = "A provider's only account cannot be removed.";
