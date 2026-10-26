// Every setting is an action (JC, 2026-10-19): "Tout doit être modifiable
// via les bots. Absolument tout. Même logique qu'un paiement, qu'un
// changement de masse ou qu'une simple application."
//
// This module decides, for one setting change a bot makes for the person
// speaking to it, whether it runs now or waits for that person's card. It
// performs nothing: server/settings-actions.ts builds the change from the
// registry (shared/settings-actions.ts) and hands it to the act engine
// (server/bot-act.ts), which replays the same route the screen calls with
// the person's own session. The person's rights are the route's: a bot never
// does what its person could not do by hand.
//
// Classes (what makes a change more than a simple application):
// - own: a setting of the person's own bot, routine, group or account.
// - rule-change: what runs without asking grows (an approval level made
//   looser, a standing grant).
// - secret: a credential, a key, a token, the vault.
// - others: another person's rights, bots or data (a share, a role, an
//   invitation, someone else's bot).
// - bulk: one change applied to several people or records.
// - delete: something removed.
// - org: an organization or server setting that touches other people.
//
// Effect, in order (the first that applies wins):
// 1. A class the person protects with a security key: card (the key signs it).
// 2. secret, others, bulk, delete, org: card, at every level, Full included,
//    like a payment or a mass change.
// 3. Not the owner's own work (the speaker does not own the bot speaking or
//    the thing changed): card.
// 4. The speaking bot at Ask or Auto-accept edits: card.
// 5. rule-change: runs only up to the speaking bot's own level, never to
//    Full or Custom (those need the owner's explicit consent on a card).
// 6. Otherwise it runs, and the audit journal records it.
//
// 2026-10-20 (JC: "le bot principal doit pouvoir absolument tout faire"):
// when the person's own Primary Bot makes the change because the person
// asked for it in this turn's message (`personAsked`, proved by a quote of
// their words, server/primary-approvals.ts), rules 4 and 5 do not apply and
// a deletion runs too: approval levels (Full included), Always allow rules
// and their removal run at once, on any of the person's own bots. A key the
// person chose, a secret, another person, several records and the
// organization keep their card.

import type { ApprovalMode } from "./approval-mode.ts";

export const SETTING_CLASSES = ["own", "rule-change", "secret", "others", "bulk", "delete", "org"] as const;
export type SettingClass = (typeof SETTING_CLASSES)[number];

/** Classes that always show a card, whatever the level. */
export const CARD_CLASSES: ReadonlySet<SettingClass> = new Set(["secret", "others", "bulk", "delete", "org"]);

const RANK: Readonly<Record<string, number>> = { ask: 0, edits: 1, auto: 2, full: 3, custom: 3 };

export type SettingHoldReason = "security-key" | "sensitive" | "not-own" | "level" | "above-level";

export type SettingEffect =
  | { effect: "run" }
  | { effect: "hold"; reason: SettingHoldReason };

export function decideSettingEffect(input: {
  classes: readonly SettingClass[];
  /** The speaking bot's level for this turn (approvalModeForTurn). */
  mode: ApprovalMode | undefined;
  /** The speaker owns the speaking bot and what the change touches. */
  ownerWork: boolean;
  /** A class of this change the person protects with a security key. */
  keyProtected: boolean;
  /** For an approval level change: the level asked. */
  approvalTo?: ApprovalMode;
  /** The person asked their Primary Bot for this change in this turn. */
  personAsked?: boolean;
}): SettingEffect {
  if (input.keyProtected) return { effect: "hold", reason: "security-key" };
  const asked = input.personAsked === true && input.ownerWork;
  if (input.classes.some((name) => CARD_CLASSES.has(name) && !(asked && name === "delete"))) return { effect: "hold", reason: "sensitive" };
  if (!input.ownerWork) return { effect: "hold", reason: "not-own" };
  if (asked) return { effect: "run" };
  const mode = input.mode ?? "ask";
  if (mode !== "auto" && mode !== "full") return { effect: "hold", reason: "level" };
  if (input.classes.includes("rule-change")) {
    const to = input.approvalTo;
    // a standing grant with no level to compare, Full and Custom: the card
    if (!to || to === "full" || to === "custom") return { effect: "hold", reason: "above-level" };
    if ((RANK[to] ?? 3) > (RANK[mode] ?? 0)) return { effect: "hold", reason: "above-level" };
  }
  return { effect: "run" };
}

/** What the bot is told when a change waits, in plain words it can relay. */
export const HOLD_TEXT: Readonly<Record<SettingHoldReason, string>> = {
  "security-key": "It waits for the person's Allow with their security key, which they chose for this kind of change.",
  sensitive: "It waits for the person's Allow: it touches a secret, another person, several records, a deletion or the organization.",
  "not-own": "It waits for the person's Allow: it is not the person's own bot or setting.",
  level: "It waits for the person's Allow: this bot is at Ask.",
  "above-level": "It waits for the person's Allow: it raises a level above this bot's own.",
};
