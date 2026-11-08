import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BriefStore, TOPIC_HALF_LIFE_MS, briefTopic, decayTopic, feedbackMemoryText, rankByFeedback, runBriefPass, topicMuted, voteTopic, type BriefPiece } from "./background-brief.ts";
import { createBackgroundBriefRoutes } from "../routes/background-brief.ts";
import { createProactiveProposalRoutes } from "../routes/proactive-proposals.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function storeAt(now: () => number = () => 1_000): BriefStore {
  const dir = mkdtempSync(join(tmpdir(), "sagax-brief-fb-"));
  dirs.push(dir);
  return new BriefStore(join(dir, "background-brief.json"), now);
}

const piece = (app: string, text: string): BriefPiece => ({ piece: `${app} / read_mail`, asOf: "2026-11-08", text });

function pass(pieces: BriefPiece[]) {
  const result = runBriefPass({ tools: ["read_mail"], pieces, costUsd: 0, fastModel: "fast" });
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe("feedback on brief items and cards (#2694)", () => {
  it("ranks the next pass by topic: less keeps one, muted drops, up goes first", () => {
    const items = [piece("Outlook", "Répondre à Carla 2026-11-08"), piece("Outlook", "Relancer Paul 2026-11-08"), piece("Teams", "Lire le fil 2026-11-08")]
      .map((source) => ({ sources: [source], text: source.text }));
    expect(rankByFeedback(items, {}).map((row) => row.text)).toEqual(items.map((row) => row.text));
    expect(rankByFeedback(items, { outlook: { up: 0, down: 0, less: 1 } }).map((row) => briefTopic(row))).toEqual(["outlook", "teams"].reverse());
    expect(rankByFeedback(items, { outlook: { up: 0, down: 0, less: 2 } }).map((row) => briefTopic(row))).toEqual(["teams"]);
    expect(rankByFeedback(items, { teams: { up: 2, down: 0, less: 0 } })[0]!.text).toContain("Lire le fil");
  });

  it("applies at the next pass: never blocks the item for good, less lowers its topic", () => {
    const store = storeAt();
    const first = store.recordPass("bot-1", pass([piece("Outlook", "Répondre à Carla 2026-11-08"), piece("Teams", "Lire le fil 2026-11-08")]));
    expect(first).toHaveLength(2);
    const outlook = first.find((row) => row.text.includes("Carla"))!;
    expect(store.feedback("bot-1", outlook.id, "never")).toMatchObject({ topic: "outlook", item: { status: "rejected", feedback: "never" } });
    const teams = first.find((row) => row.text.includes("fil"))!;
    store.feedback("bot-1", teams.id, "less");
    store.feedback("bot-1", teams.id, "less");
    const next = store.recordPass("bot-1", pass([piece("Outlook", "Répondre à Carla 2026-11-08"), piece("Teams", "Autre fil 2026-11-08"), piece("Outlook", "Relancer Paul 2026-11-08")]));
    expect(next.map((row) => row.text)).toEqual(["Relancer Paul 2026-11-08"]);
    expect(store.topics("bot-1")).toEqual({ outlook: { up: 0, down: 0, less: 0, at: 1_000 }, teams: { up: 0, down: 0, less: 2, at: 1_000 } });
    expect(store.feedback("bot-1", "missing", "up")).toBeNull();
  });

  it("reads the topic of the #2693 piece format (App, tool words) and the older one", () => {
    expect(briefTopic({ sources: [{ piece: "Outlook, courriels lus", asOf: "2026-11-08", text: "x" }] })).toBe("outlook");
    expect(briefTopic({ sources: [{ piece: "Teams / read_chat", asOf: "2026-11-08", text: "x" }] })).toBe("teams");
  });

  it("lets less and thumbs-down fade: four votes mute for now, not for good", () => {
    let row = voteTopic(undefined, "less", 0);
    for (let vote = 0; vote < 3; vote += 1) row = voteTopic(row, "down", 0);
    expect(row).toMatchObject({ less: 1, down: 3 });
    expect(topicMuted(row, 0)).toBe(true);
    // one half-life later each vote weighs half: the topic comes back
    expect(topicMuted(row, TOPIC_HALF_LIFE_MS)).toBe(false);
    expect(decayTopic(row, TOPIC_HALF_LIFE_MS)).toMatchObject({ less: 0.5, down: 1.5, at: TOPIC_HALF_LIFE_MS });
    const items = [piece("Outlook", "Relancer Paul 2026-11-08"), piece("Outlook", "Répondre à Carla 2026-11-08")].map((source) => ({ sources: [source], text: source.text }));
    expect(rankByFeedback(items, { outlook: row }, 0)).toEqual([]);
    expect(rankByFeedback(items, { outlook: row }, 3 * TOPIC_HALF_LIFE_MS)).toHaveLength(2);
    // a brief item's "never" counts nothing on its topic
    expect(voteTopic(undefined, "never", 0)).toEqual({ up: 0, down: 0, less: 0, at: 0 });
  });

  it("mutes a wake kind on never until a thumbs-up, and a less fades back", () => {
    let now = 1_000;
    const store = storeAt(() => now);
    expect(store.wakeMuted("bot-1", "heartbeat")).toBe(false);
    store.topicFeedback("bot-1", "heartbeat", "never");
    expect(store.wakeMuted("bot-1", "heartbeat")).toBe(true);
    now += 10 * TOPIC_HALF_LIFE_MS;
    expect(store.wakeMuted("bot-1", "heartbeat")).toBe(true);
    store.topicFeedback("bot-1", "heartbeat", "up");
    expect(store.wakeMuted("bot-1", "heartbeat")).toBe(false);
    store.topicFeedback("bot-1", "mail", "less");
    store.topicFeedback("bot-1", "mail", "less");
    expect(store.wakeMuted("bot-1", "mail")).toBe(true);
    now += TOPIC_HALF_LIFE_MS;
    expect(store.wakeMuted("bot-1", "mail")).toBe(false);
    expect(store.wakeMuted("bot-1", "calendar")).toBe(false);
  });

  it("writes one memory line in the person's language, without dashes", () => {
    const fr = feedbackMemoryText("less", "Relancer Paul", "outlook", "fr");
    expect(fr).toContain("moins de suggestions");
    expect(fr).toContain("Relancer Paul");
    expect(feedbackMemoryText("never", "x", "teams", "en")).toContain("never wants");
    expect(fr).not.toMatch(/[–—]/);
  });

  it("routes: brief item feedback remembers, card feedback reaches its handler", async () => {
    const store = storeAt();
    const [added] = store.recordPass("bot-1", pass([piece("Outlook", "Répondre à Carla 2026-11-08")]));
    const remembered: string[] = [];
    const brief = createBackgroundBriefRoutes({
      store, owns: () => true, fastModel: () => "fast", keep: () => {}, connected: () => ["Outlook"],
      reads: async () => { throw new Error("no read"); },
      remember: (_bot, choice, text, topic) => { remembered.push(`${choice}:${topic}:${text}`); }
    });
    const call = async (handler: typeof brief, path: string, body: unknown) => {
      let status = 0;
      let sent: unknown;
      await handler({
        req: {} as never, res: { setHeader() {} } as never, path, method: "POST", auth: {} as never,
        readBody: async () => body, json: (_res: unknown, code: number, payload: unknown) => { status = code; sent = payload; }
      } as never);
      return { status, sent };
    };
    expect((await call(brief, `/api/bots/bot-1/background-brief/${added!.id}/feedback`, { choice: "nope" })).status).toBe(400);
    expect((await call(brief, `/api/bots/bot-1/background-brief/${added!.id}/feedback`, { choice: "up" })).status).toBe(200);
    expect(remembered).toEqual(["up:outlook:Répondre à Carla 2026-11-08"]);
    // from the chat, the brief message's row shows the choice
    const shown: string[] = [];
    const wakes: string[] = [];
    const chat = createBackgroundBriefRoutes({
      store, owns: () => true, fastModel: () => "fast", keep: () => {}, connected: () => ["Outlook"],
      reads: async () => { throw new Error("no read"); },
      itemShown: (_bot, id, choice, where) => { shown.push(`${id}:${choice}:${where.threadId}:${where.messageId}`); },
      wakeFeedback: (botId, topic, choice, where) => { wakes.push(`${botId}:${topic}:${choice}:${where.messageId ?? ""}`); return { status: 200, body: { ok: true } }; }
    });
    expect((await call(chat, `/api/bots/bot-1/background-brief/${added!.id}/feedback`, { choice: "less", threadId: "t1", messageId: "m1" })).status).toBe(200);
    expect(shown).toEqual([`${added!.id}:less:t1:m1`]);
    expect((await call(chat, "/api/bots/bot-1/background-brief/wake/feedback", { choice: "less", topic: "Heartbeat", messageId: "m2" })).status).toBe(200);
    expect((await call(chat, "/api/bots/bot-1/background-brief/wake/feedback", { choice: "less", topic: "../x" })).status).toBe(400);
    expect((await call(chat, "/api/bots/bot-1/background-brief/wake/feedback", { choice: "maybe", topic: "mail" })).status).toBe(400);
    expect(wakes).toEqual(["bot-1:heartbeat:less:m2"]);
    const seen: string[] = [];
    const cards = createProactiveProposalRoutes({
      answer: () => ({ status: 200, body: {} }),
      feedback: (botId, id, choice) => { seen.push(`${botId}:${id}:${choice}`); return { status: 200, body: { ok: true } }; }
    });
    expect((await call(cards, "/api/bots/bot-1/proactive/p1/feedback", { choice: "less" })).status).toBe(200);
    expect((await call(cards, "/api/bots/bot-1/proactive/p1/feedback", { choice: 3 })).status).toBe(400);
    expect(seen).toEqual(["bot-1:p1:less"]);
  });
});
