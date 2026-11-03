import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { HistoryRow } from "../profiles/profile-versions.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { requiredScope } from "../auth/request-auth.ts";
import { createBotVersionRoutes, versionRestorePlan, type BotVersionRouteDeps } from "./bot-versions.ts";
import { PASS } from "./table.ts";

let n = 0;
const row = (field: string, before: string, after: string, at: number, extra: Partial<HistoryRow> = {}): HistoryRow => ({
  id: `r${++n}`, at, actor: "user", via: "ui", field, summary: "", before, after,
  ...(field === "soul" ? { canRestore: true } : {}), ...extra,
});

describe("versionRestorePlan", () => {
  // oldest first: v1 names it Ada, v2 changes soul and title together, v3 renames
  const rows = [
    row("name", "Bot", "Ada", 1),
    row("soul", "Be brief.", "Be thorough.", 2),
    row("title", "", "Research", 2),
    row("name", "Ada", "Aria", 3),
    row("notifications", "on", "off", 4),
  ];

  it("brings back every field changed after the version, at its value then", () => {
    const plan = versionRestorePlan(rows, rows[0]!.id);
    expect(plan).toEqual({ ok: true, patch: { soul: "Be brief.", title: "", name: "Ada", notifications: true }, skipped: [] });
  });

  it("treats the rows of one save as one version", () => {
    // v2 is both the soul row and the title row
    const viaSoul = versionRestorePlan(rows, rows[1]!.id);
    const viaTitle = versionRestorePlan(rows, rows[2]!.id);
    expect(viaSoul).toEqual(viaTitle);
    expect(viaSoul).toEqual({ ok: true, patch: { name: "Ada", notifications: true }, skipped: [] });
  });

  it("refuses the current version and an unknown one", () => {
    expect(versionRestorePlan(rows, rows[4]!.id)).toMatchObject({ ok: false, status: 400 });
    expect(versionRestorePlan(rows, "nope")).toMatchObject({ ok: false, status: 404 });
  });

  it("leaves a value the history cannot give back exactly, and says so", () => {
    const lossy = [
      row("name", "A", "B", 1),
      row("soul", "«redacted 12 chars»", "x", 2, { canRestore: false }),
      row("description", "y".repeat(200), "short", 3),
      row("cwd", "/tmp/a", "/tmp/b", 4),
    ];
    expect(versionRestorePlan(lossy, lossy[0]!.id)).toEqual({ ok: true, patch: {}, skipped: ["soul", "description", "cwd"] });
  });
});

function harness(overrides: Partial<BotVersionRouteDeps> = {}) {
  const rows = [row("name", "Bot", "Ada", 1), row("name", "Ada", "Aria", 2)];
  const apply = vi.fn(() => ({ bot: { id: "b", name: "Ada" } }));
  const deps: BotVersionRouteDeps = {
    exists: (id) => id === "b",
    ownerOrAdmin: () => true,
    rows: async () => rows,
    revision: () => "rev-1",
    apply,
    ...overrides,
  };
  const handler = createBotVersionRoutes(deps);
  const call = async (path: string, body: unknown, method = "POST") => {
    let answer: { status: number; body: unknown } | null = null;
    const result = await handler({
      req: {} as IncomingMessage, res: {} as ServerResponse, url: new URL(path, "http://x"), path, method,
      auth: { kind: "session" } as unknown as RequestAuth,
      json: (_res: ServerResponse, status: number, value: unknown) => { answer = { status, body: value }; },
      readBody: async () => body,
    } as never);
    return { result, answer: answer as { status: number; body: Record<string, unknown> } | null };
  };
  return { rows, apply, call };
}

describe("POST /api/bots/:id/history/restore", () => {
  it("restores the version and answers with the bot and what came back", async () => {
    const { rows, apply, call } = harness();
    const { answer } = await call("/api/bots/b/history/restore", { id: rows[0]!.id, expectedRevision: "rev-1" });
    expect(answer?.status).toBe(200);
    expect(apply).toHaveBeenCalledWith(expect.anything(), "b", { name: "Ada" });
    expect(answer?.body).toMatchObject({ bot: { name: "Ada" }, restored: ["name"], skipped: [] });
  });

  it("is the owner's or an admin's", async () => {
    const { rows, apply, call } = harness({ ownerOrAdmin: () => false });
    const { answer } = await call("/api/bots/b/history/restore", { id: rows[0]!.id, expectedRevision: "rev-1" });
    expect(answer?.status).toBe(403);
    expect(apply).not.toHaveBeenCalled();
    // 2026-10-26: a signed-in session reaches it; this owner check decides
    expect(requiredScope("POST", "/api/bots/b/history/restore")).toBe("client");
  });

  it("refuses a stale revision, a missing id and an unknown bot", async () => {
    const { rows, apply, call } = harness();
    expect((await call("/api/bots/b/history/restore", { id: rows[0]!.id, expectedRevision: "old" })).answer?.status).toBe(409);
    expect((await call("/api/bots/b/history/restore", { expectedRevision: "rev-1" })).answer?.status).toBe(400);
    expect((await call("/api/bots/zz/history/restore", { id: rows[0]!.id, expectedRevision: "rev-1" })).answer?.status).toBe(404);
    expect(apply).not.toHaveBeenCalled();
  });

  it("passes other routes through", async () => {
    const { call } = harness();
    expect((await call("/api/bots/b/history", {}, "GET")).result).toBe(PASS);
    expect((await call("/api/bots/b/history/restore", {}, "GET")).result).toBe(PASS);
  });
});
