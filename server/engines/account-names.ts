// The name a person gives one of their accounts on an organization server
// (#4376, Providers > a provider > Accounts: "I should be able to rename
// existing one"). The engine belongs to the organization, so its own name
// (config displayName) is everyone's; the name a person types here is theirs
// alone and shows wherever that account is shown to them (the model menu,
// a bot's settings, Providers): GET /api/instances and GET /api/me/engines
// read it through instancesForViewer and engineNameForPerson. On a solo
// server the account is the person's own and its name is the engine's
// (PATCH /api/instances/:id).
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";

/** The longest name kept, as an engine's own name (claude-accounts.ts). */
export const ACCOUNT_NAME_MAX = 80;

/** A name as typed, trimmed; "" clears it; null when it cannot be kept. */
export function cleanAccountName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (name.length > ACCOUNT_NAME_MAX || /\p{Cc}/u.test(name)) return null;
  return name;
}

export interface AccountNames {
  /** The person's own name for an account, if they gave one. */
  get(person: string | null | undefined, instanceId: string): string | undefined;
  /** Keeps a name ("" removes it, back to the engine's own). */
  set(person: string, instanceId: string, name: string): void;
  /** #4415: the person removed this account from their own list (an
   * organization's account stays everyone else's). */
  removed(person: string | null | undefined, instanceId: string): boolean;
  /** Takes the account off the person's own list (its name goes with it). */
  remove(person: string, instanceId: string): void;
}

type Stored = Record<string, Record<string, string>>;

const personKey = (person: string) => person.trim().toLowerCase();

export function createAccountNames(dataDir: string): AccountNames {
  const file = join(dataDir, "account-names.json");
  let data: Stored | null = null;
  const read = (): Stored => {
    if (data) return data;
    try {
      const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
      data = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Stored : {};
    } catch {
      data = {};
    }
    return data;
  };
  // #4415: the accounts each person removed, beside their names
  const removedFile = join(dataDir, "removed-accounts.json");
  let removedData: Record<string, string[]> | null = null;
  const readRemoved = (): Record<string, string[]> => {
    if (removedData) return removedData;
    try {
      const raw: unknown = JSON.parse(readFileSync(removedFile, "utf8"));
      removedData = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, string[]> : {};
    } catch {
      removedData = {};
    }
    return removedData;
  };
  const names: AccountNames = {
    get(person, instanceId) {
      if (!person) return undefined;
      const name = read()[personKey(person)]?.[instanceId];
      return typeof name === "string" && name ? name : undefined;
    },
    set(person, instanceId, name) {
      const all = read();
      const key = personKey(person);
      const own = { ...all[key] };
      if (name) own[instanceId] = name;
      else delete own[instanceId];
      const next: Stored = { ...all };
      if (Object.keys(own).length) next[key] = own;
      else delete next[key];
      writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      data = next;
    },
    removed(person, instanceId) {
      if (!person) return false;
      const own = readRemoved()[personKey(person)];
      return Array.isArray(own) && own.includes(instanceId);
    },
    remove(person, instanceId) {
      const all = readRemoved();
      const key = personKey(person);
      const own = Array.isArray(all[key]) ? all[key] : [];
      if (!own.includes(instanceId)) {
        const next = { ...all, [key]: [...own, instanceId] };
        writeFileAtomic(removedFile, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        removedData = next;
      }
      if (names.get(person, instanceId)) names.set(person, instanceId, "");
    },
  };
  return names;
}
