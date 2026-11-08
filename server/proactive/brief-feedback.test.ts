import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BriefStore, briefTopic, feedbackMemoryText, rankByFeedback, runBriefPass, type BriefPiece } from "./background-brief.ts";
import { createBackgroundBriefRoutes } from "../routes/background-brief.ts";
import { createProactiveProposalRoutes } from "../routes/proactive-proposals.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function storeAt(): BriefStore {
  const dir = mkdtempSync(join(tmpdir(), "sagax-brief-fb-"));
  dirs.push(dir);
  return new BriefStore(join(dir, "background-brief.json"), () => 1_000);
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
    expect(store.topics("bot-1")).toEqual({ outlook: { up: 0, down: 0, less: 0 }, teams: { up: 0, down: 0, less: 2 } });
    expect(store.feedback("bot-1", "missing", "up")).toBeNull();
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
