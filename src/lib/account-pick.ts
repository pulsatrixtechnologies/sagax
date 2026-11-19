// #5014: the account a conversation's turn took by the person's account
// strategy, and why, in the reader's language (shared/account-switch.ts):
// the model chip's tooltip says it, once, beside the account it names.
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { accountPickWords, type AccountPick } from "../../shared/account-switch";
import type { ModelSelection } from "@/state/store";

/** The pick's one line ("Compte B : sa fenêtre repart dans 40 min avec 60 % inutilisé"). */
export function accountPickLine(pick: Pick<AccountPick, "account" | "why">, now = Date.now()): string {
  const { key, vars } = accountPickWords(pick, now);
  return t(key as LocaleKey, vars);
}

/** The line for the chip while the pick still names the account in use:
 * never for Auto, nor for an account the person forced on the Account line. */
export function accountPickChipLine(pick: AccountPick | undefined, selection: Pick<ModelSelection, "instanceId" | "auto" | "accountPinned">, now = Date.now()): string {
  if (!pick || selection.auto === true || selection.accountPinned === true || pick.instanceId !== selection.instanceId) return "";
  return accountPickLine(pick, now);
}
