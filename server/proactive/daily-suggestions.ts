/** #2693: the primary bot's free daily suggestions.
 *
 * The background brief (background-brief.ts) already finds what deserves the
 * person's look, with no model call (its pass costs 0). For the primary bot,
 * up to DAILY_SUGGESTIONS_MAX of those points a day also become a one-gesture
 * card in the person's chat: "Fais-le" starts the work at once (an accepted
 * proactive wake, outside the wake budget), "Pas maintenant" leaves it.
 * Picking and posting a suggestion never calls a model and never counts
 * toward any usage: only the work the person asks for runs on the engine. */
import type { BriefSuggestion } from "./background-brief.ts";
import type { ProactiveEvent } from "./proactive-wake.ts";

/** At most this many suggestion cards per bot in any 24 hours. */
export const DAILY_SUGGESTIONS_MAX = 3;
export const DAILY_SUGGESTIONS_WINDOW_MS = 24 * 60 * 60_000;

/** The suggestions to post now: pending, one per identity, at most what the
 * day still allows (`postedToday` cards already went out in the window). */
export function pickDailySuggestions(items: readonly BriefSuggestion[], postedToday: number, max = DAILY_SUGGESTIONS_MAX): BriefSuggestion[] {
  const room = Math.max(0, max - Math.max(0, postedToday));
  if (!room) return [];
  const seen = new Set<string>();
  const out: BriefSuggestion[] = [];
  for (const item of items) {
    if (item.status !== "pending" || !item.text.trim()) continue;
    if (seen.has(item.identity)) continue;
    seen.add(item.identity);
    out.push(item);
    if (out.length >= room) break;
  }
  return out;
}

export interface DailySuggestionCard {
  title: string;
  subtitle: string;
  /** options[0] accepts (proactiveProposalAccepts), options[1] declines. */
  options: [string, string];
}

const TITLE_MAX = 140;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** The card, in the person's language. */
export function dailySuggestionCard(item: BriefSuggestion, language: "fr" | "en"): DailySuggestionCard {
  const fr = language === "fr";
  const source = item.sources[0];
  const from = source ? (fr ? ` D'après ${source.piece}, ${source.asOf}.` : ` From ${source.piece}, ${source.asOf}.`) : "";
  return {
    title: clip(item.text, TITLE_MAX),
    subtitle: fr
      ? `Suggestion du jour, gratuite.${from} Je m'en occupe ?`
      : `Today's suggestion, free.${from} Shall I handle it?`,
    options: fr ? ["Fais-le", "Pas maintenant"] : ["Do it", "Not now"]
  };
}

/** The event an accepted suggestion runs on. Its detail quotes the person's
 * own data (mail, files), untrusted: the wake reads it inside a fence and
 * runs confined (S2), like any wake on relayed content. */
export function dailySuggestionEvent(botId: string, item: BriefSuggestion): ProactiveEvent {
  const sources = item.sources.map((piece) => `- ${piece.piece} (${piece.asOf}): ${piece.text}`);
  return {
    botId,
    source: "suggestion",
    key: `suggestion:${item.id}`,
    label: "Daily suggestion",
    detail: [`Suggestion: ${item.text}`, ...(sources.length ? ["Sources:", ...sources] : [])].join("\n"),
    summary: clip(item.text, TITLE_MAX),
    hops: 0,
    confined: true
  };
}

/** How many suggestion cards this bot posted in the window ending now. */
export function suggestionsPostedSince(proposals: ReadonlyArray<{ botId: string; createdAt: number; events: ReadonlyArray<{ source: string }> }>, botId: string, since: number): number {
  return proposals.filter((item) => item.botId === botId && item.createdAt >= since && item.events.some((event) => event.source === "suggestion")).length;
}
