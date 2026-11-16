// #4435: on an organization server, an account a person adds beside a
// provider's first one (Providers > a provider > Add account) is theirs:
// its entry in the server's provider instances carries `ownerPrincipalId`.
// Only that person sees it, signs in to it, renames it, removes it, and only
// a turn that person pays for runs on it (engine-credentials.ts). An entry
// with no owner is the organization's (its first accounts, what an
// administrator configured for everyone, and accounts added before #4435
// whose adder the server never recorded).
import type { InstanceConfigMap } from "../contracts.ts";

const personKey = (principalId: string) => principalId.trim().toLowerCase();

/** The person an account belongs to, or undefined for the organization's. */
export function accountOwnerOf(instances: Readonly<Record<string, { ownerPrincipalId?: string }>> | InstanceConfigMap | undefined, instanceId: string): string | undefined {
  const entry = instances && Object.hasOwn(instances, instanceId) ? (instances as Record<string, { ownerPrincipalId?: unknown }>)[instanceId] : undefined;
  const owner = typeof entry?.ownerPrincipalId === "string" ? personKey(entry.ownerPrincipalId) : "";
  return owner || undefined;
}

/** Whether `person` may see and use an account owned by `owner`
 * (undefined: the organization's, everyone's). */
export function accountOwnedBy(owner: string | undefined, person: string | null | undefined): boolean {
  return owner === undefined || (typeof person === "string" && personKey(person) === owner);
}

/** #4435 point 4: an account added before the server recorded who added it
 * (no owner), with what the data tells about it. Never a guess: the server
 * keeps it the organization's and lists the case for the owner to decide. */
export interface UnownedAddedAccount {
  instanceId: string;
  driver: string;
  /** false: a named Claude account from before #2373, which signs in from
   * each person's first Claude folder (no folder of its own). */
  ownFolder: boolean;
  /** People with a sign-in to it, most recent sign-in first. */
  signedInBy: string[];
  /** People whose bots run on it (model, backup or a conversation's model). */
  usedByBotsOf: string[];
}

export interface UnownedAccountFacts {
  /** Who has a sign-in to this account, and when they signed in. */
  signedInAt(instanceId: string, driver: string): Array<{ principalId: string; at: number }>;
  /** The owners of the bots that use this account. */
  botOwners(instanceId: string): string[];
}

/** The added accounts with no recorded owner, with the evidence the server
 * has for each; the organization's first accounts and its own engines are
 * not in it. */
export function unownedAddedAccounts(
  instances: Readonly<Record<string, { driver: string; ownerPrincipalId?: string }>>,
  facts: UnownedAccountFacts,
  added: (instanceId: string, driver: string) => boolean,
  ownFolder: (instanceId: string) => boolean,
): UnownedAddedAccount[] {
  const cases: UnownedAddedAccount[] = [];
  for (const [instanceId, entry] of Object.entries(instances)) {
    if (!added(instanceId, entry.driver) || accountOwnerOf(instances, instanceId) !== undefined) continue;
    const signedIn = facts.signedInAt(instanceId, entry.driver).slice().sort((a, b) => b.at - a.at);
    const usedByBotsOf = [...new Set(facts.botOwners(instanceId).map(personKey).filter(Boolean))].sort();
    cases.push({
      instanceId, driver: entry.driver, ownFolder: ownFolder(instanceId),
      signedInBy: [...new Set(signedIn.map((login) => personKey(login.principalId)).filter(Boolean))],
      usedByBotsOf,
    });
  }
  return cases;
}

/** One line per case for the server log: ids only, never a name, an address or a secret. */
export function describeUnownedAccount(entry: UnownedAddedAccount): string {
  const folder = entry.ownFolder ? "own sign-in folder" : "signs in from each person's first folder";
  const signedIn = entry.signedInBy.length ? `signed in by ${entry.signedInBy.join(", ")} (most recent first)` : "nobody signed in";
  const bots = entry.usedByBotsOf.length ? `bots of ${entry.usedByBotsOf.join(", ")} use it` : "no bot uses it";
  return `[accounts] added account ${entry.instanceId} (${entry.driver}) has no recorded owner and stays the organization's: ${folder}; ${signedIn}; ${bots}.`;
}
