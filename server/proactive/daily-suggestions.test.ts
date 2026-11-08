import { describe, expect, it } from "vitest";
import type { BriefSuggestion } from "./background-brief.ts";
import { DAILY_SUGGESTIONS_MAX, dailySuggestionCard, dailySuggestionEvent, pickDailySuggestions, suggestionsPostedSince } from "./daily-suggestions.ts";
import { ProactiveProposals, proactiveRelevance, proactiveWakePrompt, wakeAlwaysReports } from "./proactive-wake.ts";
import { proactiveProposalAccepts } from "../../shared/proactive-proposal.ts";

function item(id: string, over: Partial<BriefSuggestion> = {}): BriefSuggestion {
  return {
    id, text: `Répondre au contrat ${id}`, identity: `id-${id}`, status: "pending", at: 1, costUsd: 0, model: "fast",
    sources: [{ piece: "courriel de Carla", asOf: "2026-11-08", text: "Peux-tu signer le contrat ?" }],
    ...over
  };
}

describe("daily suggestions (#2693)", () => {
  it("keeps at most 3 a day, pending only, one per identity", () => {
    const items = [item("a"), item("b", { status: "rejected" }), item("c"), item("d", { identity: "id-a" }), item("e"), item("f")];
    expect(pickDailySuggestions(items, 0).map((row) => row.id)).toEqual(["a", "c", "e"]);
    expect(pickDailySuggestions(items, 2).map((row) => row.id)).toEqual(["a"]);
    expect(pickDailySuggestions(items, DAILY_SUGGESTIONS_MAX)).toEqual([]);
    expect(pickDailySuggestions([item("x", { text: "  " })], 0)).toEqual([]);
  });

  it("is a one-gesture card whose first option accepts", () => {
    const fr = dailySuggestionCard(item("a"), "fr");
    expect(fr.options).toEqual(["Fais-le", "Pas maintenant"]);
    expect(fr.subtitle).toContain("gratuite");
    expect(fr.subtitle).toContain("courriel de Carla");
    const card = { options: [...fr.options], proactiveProposal: { id: "p" } };
    expect(proactiveProposalAccepts(card, "Fais-le")).toBe(true);
    expect(proactiveProposalAccepts(card, "Pas maintenant")).toBe(false);
    expect(dailySuggestionCard(item("a"), "en").options).toEqual(["Do it", "Not now"]);
    expect(`${fr.title}${fr.subtitle}`).not.toMatch(/[–—]/);
  });

  it("runs as a confined, always-reporting wake with its own rules", () => {
    const event = dailySuggestionEvent("bot-1", item("a"));
    expect(event).toMatchObject({ botId: "bot-1", source: "suggestion", key: "suggestion:a", confined: true, hops: 0 });
    expect(proactiveRelevance(event)).not.toBeNull();
    expect(wakeAlwaysReports([event])).toBe(true);
    const prompt = proactiveWakePrompt({ mode: "proactive", events: [event], more: 0 }, { accepted: true });
    expect(prompt).toContain("Daily suggestion");
    expect(prompt).toContain("Peux-tu signer le contrat ?");
  });

  it("counts the cards posted in the window, answered or not", () => {
    let now = 1_000_000;
    const proposals = new ProactiveProposals(null, () => now);
    const add = (botId: string, source: "suggestion" | "mail") => proposals.add({
      botId, threadId: "t", messageId: "", more: 0, hops: 0, confined: true,
      events: [{ ...dailySuggestionEvent(botId, item("a")), source }]
    });
    const first = add("bot-1", "suggestion");
    add("bot-1", "mail");
    add("bot-2", "suggestion");
    proposals.answer(first.id, "declined");
    expect(suggestionsPostedSince(proposals.all(), "bot-1", 0)).toBe(1);
    now += 10;
    expect(suggestionsPostedSince(proposals.all(), "bot-1", now - 5)).toBe(0);
  });
});
