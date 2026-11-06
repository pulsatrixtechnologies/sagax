// #2106: when several subscription accounts of one provider offer the same
// model, the picker shows the model once. At turn time Sagax picks which
// account runs it: credits available first, then the account that holds the
// managed MCP plugin the turn needs, then the next account after a
// rate-limit or credit refusal. Pure: the host passes account facts in.

export type AccountCreditState = "ok" | "out" | "rate_limited" | "unknown";

export interface PoolAccount {
  instanceId: string;
  /** Models this account can run. */
  models: readonly string[];
  credit: AccountCreditState;
  /** Managed MCP plugin ids this account has. */
  managedPlugins: readonly string[];
}

const CREDIT_RANK: Record<AccountCreditState, number> = {
  ok: 0,
  unknown: 1,
  rate_limited: 2,
  out: 3,
};

function hasPlugins(account: PoolAccount, needed: readonly string[]): boolean {
  if (needed.length === 0) return true;
  const held = new Set(account.managedPlugins);
  return needed.every((id) => held.has(id));
}

/** The instanceId that should run `model`, or null when none can. */
export function pickAccountForModel(input: {
  model: string;
  accounts: readonly PoolAccount[];
  /** Prefer this instance when it is still usable. */
  preferredInstanceId?: string;
  /** Plugin ids the turn needs from a managed MCP account. */
  neededPlugins?: readonly string[];
  /** Instance ids already tried that failed (rate limit / credits). */
  skip?: readonly string[];
}): string | null {
  const skip = new Set(input.skip ?? []);
  const needed = input.neededPlugins ?? [];
  const usable = input.accounts.filter((account) =>
    !skip.has(account.instanceId)
    && account.models.includes(input.model)
    && account.credit !== "out"
    && account.credit !== "rate_limited");
  if (usable.length === 0) return null;

  const withPlugins = needed.length > 0 ? usable.filter((account) => hasPlugins(account, needed)) : usable;
  const pool = withPlugins.length > 0 ? withPlugins : usable;

  const ranked = [...pool].sort((a, b) => {
    const credit = CREDIT_RANK[a.credit] - CREDIT_RANK[b.credit];
    if (credit !== 0) return credit;
    if (input.preferredInstanceId) {
      if (a.instanceId === input.preferredInstanceId) return -1;
      if (b.instanceId === input.preferredInstanceId) return 1;
    }
    return a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0;
  });
  return ranked[0]?.instanceId ?? null;
}

/** Accounts of one subscription family that offer `model` (for the picker:
 * one row per model across those accounts). */
export function accountsForModel(accounts: readonly PoolAccount[], model: string): PoolAccount[] {
  return accounts.filter((account) => account.models.includes(model));
}

/** A managed MCP plugin name as the pool compares it ("Microsoft 365",
 * "microsoft-365" and "Microsoft365" are one plugin). */
export function pluginKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** #2106: the managed MCP plugins a turn needs, read from what the person
 * asked: every plugin held by one of the accounts whose name the words say
 * ("check my Gmail", "post in Slack"). Keys as pluginKey returns them. */
export function pluginsNamedIn(text: string, known: readonly string[]): string[] {
  const words = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const joined = pluginKey(text);
  const out = new Set<string>();
  for (const name of known) {
    const key = pluginKey(name);
    if (key.length < 3) continue;
    const spaced = ` ${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
    if (words.includes(spaced) || (key.length >= 6 && joined.includes(key))) out.add(key);
  }
  return [...out];
}
