// #4376 (the owner 2026-11-15 on the Providers list: "The sign out is
// duplicated weirdly", "it's not clickable, it's totally wrongly done"): a
// provider is one row and one click target, with ONE line that sums it up
// in plain words, and no button once it is connected (signing out,
// disconnecting, removing and turning off live on the provider's page).
// The one button a row may carry is the first action of a provider that is
// not connected yet. On the provider's page, an account is named (the
// person can rename it), its sign-in address under the name.
import type { InstanceInfo } from "@/state/store";
import { t } from "@/lib/i18n";
import { isToolName, type ConnectionAction, type ProviderGroup, type ProviderRow } from "@/lib/provider-rows";

/** The words of a provider's one line on the list, and their tone. */
export interface ProviderSummary {
  text: string;
  tone: "neutral" | "warning";
}

const modelsWords = (count: number, where: "computer" | "server") =>
  where === "computer"
    ? t(count === 1 ? "providers.summary.computerModelOne" : "providers.summary.computerModels", { count })
    : t(count === 1 ? "providers.brings.modelOne" : "providers.brings.models", { count });

/** What the list says of one provider (#4376): "Connected", "2 accounts
 * connected", "Connected · your bots there too", "Sign in to use it",
 * "6 models on this computer"; a state to fix in its own words. */
export function providerSummary(group: ProviderGroup, botsThere = false): ProviderSummary {
  const models = group.rows.reduce((sum, row) => sum + (row.brings.find((item): item is { models: number } => typeof item === "object")?.models ?? 0), 0);
  if (group.kind === "computer") return { text: modelsWords(models, "computer"), tone: "neutral" };
  if (group.state === "connected") {
    if (group.kind === "server") return { text: modelsWords(models, "server"), tone: "neutral" };
    const accounts = group.rows.filter((row) => row.kind === "account" && row.state === "connected").length;
    const base = accounts > 1 ? t("providers.summary.accounts", { count: accounts }) : t("providers.state.connected");
    const state = botsThere ? t("providers.summary.withBots", { state: base }) : base;
    // an account whose sign-in expired beside a connected one is said on the
    // row, in amber, never hidden behind "Connected" (#4376 review)
    const expired = expiredAccounts(group).length;
    if (expired) return { text: t(expired === 1 ? "providers.summary.reconnectOne" : "providers.summary.reconnectSome", { state, count: expired }), tone: "warning" };
    return { text: state, tone: "neutral" };
  }
  if (group.state === "reconnect") return { text: t("providers.summary.reconnect"), tone: "warning" };
  if (group.state === "keyMissing") return { text: t("providers.state.keyMissing"), tone: "warning" };
  if (group.state === "offline") return { text: t("providers.state.offline"), tone: "warning" };
  return { text: t("providers.summary.signIn"), tone: "neutral" };
}

/** The accounts of a provider whose sign-in expired. */
function expiredAccounts(group: ProviderGroup): ProviderRow[] {
  return group.rows.filter((row) => row.kind === "account" && row.state === "reconnect");
}

/** The actions a row of the list may carry: the first step of a provider
 * not connected yet. Everything else is on its page. */
const FIRST_STEPS: ReadonlySet<ConnectionAction> = new Set(["signIn", "signInAgain", "addKey", "turnOn"]);

/** The row of a provider whose first step the list's button takes, or null
 * (a connected provider with no expired account, or one whose fix is not a
 * first step: a server offline). */
export function firstStepRow(group: ProviderGroup, actionOf: (row: ProviderRow) => ConnectionAction | null): ProviderRow | null {
  // a connected provider with an expired account keeps that account's Sign in again
  const row = group.state === "connected" ? expiredAccounts(group)[0] : group.rows[0];
  const action = row ? actionOf(row) : null;
  return row && action && FIRST_STEPS.has(action) ? row : null;
}

/** The account rows of a provider's page (Accounts lists only sign-ins). */
export function accountRows(group: ProviderGroup): ProviderRow[] {
  return group.rows.filter((row) => row.kind === "account");
}

type AccountInstance = Pick<InstanceInfo, "instanceId" | "displayName" | "snapshot">;

/** An account's sign-in address, when the engine says it. */
export function accountAddress(row: ProviderRow, instances: readonly AccountInstance[]): string | null {
  const instance = instances.find((entry) => row.instanceIds.includes(entry.instanceId));
  return instance?.snapshot.account?.email?.trim() || null;
}

/** An account's name (#4376): the one the person gave it, a plan's own
 * name, else a sensible label ("Your account", "Account 2"), never the
 * provider's name again, a tool's name or the address it already shows. */
export function accountName(row: ProviderRow, group: Pick<ProviderGroup, "name">, instances: readonly AccountInstance[], index: number, total: number): string {
  const instance = instances.find((entry) => row.instanceIds.includes(entry.instanceId));
  const name = (instance?.displayName ?? row.name).trim();
  const address = accountAddress(row, instances);
  if (name && name.toLowerCase() !== group.name.trim().toLowerCase() && !isToolName(name) && name !== address) return name;
  return total > 1 ? t("providers.account.numbered", { number: index + 1 }) : t("providers.account.default");
}
