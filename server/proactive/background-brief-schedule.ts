// The background brief on its own timer (2026-10-29).
//
// Until now a pass ran only when the person clicked "Read connected apps".
// Every minute the server now asks each bot whether the person's daily time
// came (BriefStore.scheduledDue: their time, in their time zone, not yet
// today). The day is taken BEFORE the reads, so a slow pass or a restart
// never sends the same brief twice. The pass itself is the click's: reads
// only, every number cited with its dated piece, a rejection never proposed
// again (server/proactive/background-brief.ts).
//
// What it found is delivered twice, the way the person chose:
//   - in the bot's conversation with them, as one bot message;
//   - through "Me joindre" (server/reach-me/service.ts `notice`): a push,
//     a text, Teams, Telegram or WhatsApp, as set for that bot, within
//     their hours (held until the next range otherwise).
// A pass with nothing new sends nothing. The brief is on by default for a
// Primary Bot; the person turns it off or moves its time on the bot page.
import { readConnectedBrief, type BriefAppCall, type BriefStore, type BriefSuggestion } from "./background-brief.ts";

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

export interface BriefScheduleDeps {
  store: BriefStore;
  bots(): readonly ScheduledBriefBot[];
  connected(botId: string): readonly string[];
  fastModel(botId: string): string | null;
  reads(botId: string): Promise<BriefAppCall>;
  deliver(input: BriefDelivery): Promise<void> | void;
  now?(): number;
  log?(line: string): void;
}

/** The bot message of a brief, in the person's language. */
export function briefMessageText(suggestions: readonly BriefSuggestion[], language: "fr" | "en"): string {
  const fr = language === "fr";
  const lines = [fr ? "**Brief du jour**" : "**Today's brief**", ""];
  for (const item of suggestions.slice(0, 12)) {
    const source = item.sources[0];
    lines.push(`- ${item.text}${source ? ` (${source.piece}, ${source.asOf})` : ""}`);
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
  return { title, lines: suggestions.slice(0, 3).map((item) => item.text) };
}

/** One minute's round. Never throws; returns the bots whose brief was delivered. */
export async function runScheduledBriefs(deps: BriefScheduleDeps): Promise<string[]> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const delivered: string[] = [];
  for (const bot of deps.bots()) {
    try {
      if (!bot.person || !deps.store.scheduledDue(bot.id, now())) continue;
      // today's run is taken before anything is read
      deps.store.markScheduled(bot.id, now());
      if (!deps.connected(bot.id).length) continue;
      const call = await deps.reads(bot.id);
      const rejected = deps.store.view(bot.id).suggestions.filter((item) => item.status === "rejected").map((item) => item.identity);
      const pass = await readConnectedBrief(call, { costUsd: 0, fastModel: deps.fastModel(bot.id) }, rejected);
      if (!pass.ok) {
        log(`background brief: ${bot.id} skipped (${pass.error})`);
        continue;
      }
      if (!pass.suggestions.length) {
        deps.store.markPass(bot.id, now());
        continue;
      }
      const added = deps.store.recordPass(bot.id, pass);
      if (!added.length) continue;
      await deps.deliver({ botId: bot.id, botName: bot.name, person: bot.person, suggestions: added });
      delivered.push(bot.id);
    } catch (error) {
      log(`background brief: ${bot.id} failed (${error instanceof Error ? error.message.slice(0, 120) : "error"})`);
    }
  }
  return delivered;
}

/** Runs `runScheduledBriefs` every minute, one round at a time. */
export function startBriefTimer(deps: BriefScheduleDeps, everyMs = 60_000): { stop(): void } {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void runScheduledBriefs(deps).finally(() => { running = false; });
  }, everyMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
