// The background brief, run by its routine (#3456, lot 5 of #3408).
//
// The brief is a routine of the bot (server/proactive/brief-routine.ts),
// created only on the person's yes: there is no timer of its own any more,
// and nothing runs because of a default. At the routine's time its code
// pre-check (routine-precheck.ts `daily_brief`) runs `runBrief` below: reads
// only, every number cited with its dated piece, a rejection never proposed
// again (server/proactive/background-brief.ts). No model turn starts.
//
// What it found is delivered twice, the way the person chose:
//   - in the bot's conversation with them, as one bot message;
//   - through "Me joindre" (server/reach-me/service.ts `notice`): a push,
//     a text, Teams, Telegram or WhatsApp, as set for that bot, within
//     their hours (held until the next range otherwise).
// A pass with nothing new sends nothing.
import { readConnectedBrief, suggestionAction, type BriefAppCall, type BriefStore, type BriefSuggestion } from "./background-brief.ts";

export interface ScheduledBriefBot {
  id: string;
  name: string;
  /** The person the brief is for (the bot's owner). Null: no one, skipped. */
  person: string | null;
}

export interface BriefDelivery {
  botId: string;
  botName: string;
  person: string;
  suggestions: BriefSuggestion[];
}

export interface BriefRunDeps {
  store: BriefStore;
  connected(botId: string): readonly string[];
  fastModel(botId: string): string | null;
  reads(botId: string): Promise<BriefAppCall>;
  deliver(input: BriefDelivery): Promise<void> | void;
  now?(): number;
}

/** What one run of the brief did, in a line for the routine's run log. */
export type BriefRunOutcome =
  | { kind: "delivered"; count: number }
  | { kind: "nothing-new" }
  | { kind: "no-apps" }
  | { kind: "no-person" }
  | { kind: "skipped"; error: string };

/** The bot message of a brief, in the person's language. */
export function briefMessageText(suggestions: readonly BriefSuggestion[], language: "fr" | "en"): string {
  const fr = language === "fr";
  const lines = [fr ? "**Brief du jour**" : "**Today's brief**", ""];
  for (const item of suggestions.slice(0, 12)) {
    const source = item.sources[0];
    lines.push(`- ${suggestionAction(item, language)}${source ? ` (${source.asOf})` : ""}`);
  }
  lines.push("", fr
    ? "Garde ou rejette chaque point dans les réglages du bot, section Brief en arrière-plan."
    : "Keep or reject each point in the bot's settings, Background brief section.");
  return lines.join("\n");
}

/** The short form "Me joindre" sends (a push, a text). */
export function briefNoticeLines(suggestions: readonly BriefSuggestion[], language: "fr" | "en"): { title: string; lines: string[] } {
  const fr = language === "fr";
  const count = suggestions.length;
  const title = fr
    ? `Brief du jour : ${count} point${count > 1 ? "s" : ""}`
    : `Today's brief: ${count} point${count > 1 ? "s" : ""}`;
  return { title, lines: suggestions.slice(0, 3).map((item) => suggestionAction(item, language)) };
}

/** One run of the brief for one bot (its routine's time came). Reads
 * only; no model turn. Throws only when the delivery itself fails. */
export async function runBrief(bot: ScheduledBriefBot, deps: BriefRunDeps): Promise<BriefRunOutcome> {
  const now = deps.now ?? Date.now;
  if (!bot.person) return { kind: "no-person" };
  if (!deps.connected(bot.id).length) return { kind: "no-apps" };
  const call = await deps.reads(bot.id);
  const rejected = deps.store.view(bot.id).suggestions.filter((item) => item.status === "rejected").map((item) => item.identity);
  const pass = await readConnectedBrief(call, { costUsd: 0, fastModel: deps.fastModel(bot.id) }, rejected);
  if (!pass.ok) return { kind: "skipped", error: pass.error };
  if (!pass.suggestions.length) {
    deps.store.markPass(bot.id, now());
    return pass.notice === "no_apps" ? { kind: "no-apps" } : { kind: "nothing-new" };
  }
  const added = deps.store.recordPass(bot.id, pass);
  if (!added.length) return { kind: "nothing-new" };
  await deps.deliver({ botId: bot.id, botName: bot.name, person: bot.person, suggestions: added });
  return { kind: "delivered", count: added.length };
}

/** The run's line in the routine's log, in the person's language. */
export function briefRunReason(outcome: BriefRunOutcome, language: "fr" | "en"): string {
  const fr = language === "fr";
  switch (outcome.kind) {
    case "delivered":
      return fr
        ? `Brief du jour envoyé : ${outcome.count} point${outcome.count > 1 ? "s" : ""}.`
        : `Today's brief sent: ${outcome.count} point${outcome.count > 1 ? "s" : ""}.`;
    case "nothing-new":
      return fr ? "Rien de nouveau aujourd'hui : aucun brief envoyé." : "Nothing new today: no brief sent.";
    case "no-apps":
      return fr ? "Aucune app connectée à lire : aucun brief envoyé." : "No connected app to read: no brief sent.";
    case "no-person":
      return fr ? "Ce bot n'a personne à qui envoyer le brief." : "This bot has no person to send the brief to.";
    case "skipped":
      return fr ? `Brief non lu : ${outcome.error}` : `Brief not read: ${outcome.error}`;
  }
}
