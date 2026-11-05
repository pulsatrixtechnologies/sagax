// Characterization of GET /api/admin-activity and /api/admin-activity.csv.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { appendAdminAction, flushAdminActivity } from "../activity/admin-activity.ts";
import { appendDecision, flushDecisionLog } from "../decision-log.ts";
import { createAdminActivityRoutes } from "./admin-activity.ts";
import { PASS } from "./table.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function harness() {
  const dataDir = mkdtempSync(join(tmpdir(), "sagax-activity-"));
  dirs.push(dataDir);
  appendDecision(dataDir, {
    threadId: "t1",
    botId: "b1",
    botName: "Bot",
    tool: "Bash",
    summary: "ls",
    decision: "user-approved",
    source: "user",
    actor: { kind: "session", sessionId: "s1", label: "Ada", email: "ada@example.test" },
  });
  appendAdminAction(dataDir, {
    category: "config",
    action: "config.update",
    changed: ["language"],
    actor: { kind: "session", sessionId: "s1", label: "Ada", email: "ada@example.test" },
  });
  await flushDecisionLog(dataDir);
  await flushAdminActivity(dataDir);
  const route = createAdminActivityRoutes({
    dataDir,
    adminPersonName: (id) => id === "pr_x" ? "Pat" : id,
    adminActivityRecording: () => true,
  });
  const call = async (pathWithQuery: string) => {
    const path = pathWithQuery.split("?")[0]!;
    const sent: Array<{ status: number; body: unknown }> = [];
    let ended: string | undefined;
    let head: { status: number; headers: Record<string, string> } | undefined;
    const out = await route({
      req: { headers: {} } as never,
      res: {
        writeHead: (status: number, headers: Record<string, string>) => { head = { status, headers }; },
        end: (body?: string) => { ended = body; },
        setHeader: () => undefined,
      } as never,
      url: new URL(`http://localhost${pathWithQuery}`),
      path,
      method: "GET",
      auth: { kind: "loopback", scopes: ["admin"] } as never,
      json: ((_: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as never,
      readBody: (async () => ({})) as never,
    });
    return { out, sent: sent[0], head, ended };
  };
  return { call };
}

describe("GET /api/admin-activity", () => {
  it("refuses a bad what and a bad range", async () => {
    const h = await harness();
    expect((await h.call("/api/admin-activity?what=nope")).sent).toMatchObject({ status: 400 });
    expect((await h.call("/api/admin-activity?from=nope")).sent).toMatchObject({ status: 400 });
  });

  it("lists entries with recording and retention, and exports CSV", async () => {
    const h = await harness();
    const today = new Date().toISOString().slice(0, 10);
    const list = await h.call(`/api/admin-activity?from=${today}&to=${today}`);
    expect(list.sent?.status).toBe(200);
    const body = list.sent?.body as {
      entries: unknown[];
      total: number;
      recording: boolean;
      retentionDays: number;
    };
    expect(body.recording).toBe(true);
    expect(body.retentionDays).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.entries)).toBe(true);

    const csv = await h.call(`/api/admin-activity.csv?from=${today}&to=${today}`);
    expect(csv.head?.status).toBe(200);
    expect(String(csv.head?.headers["content-type"])).toContain("text/csv");
    expect(csv.ended).toContain("time");
  });

  it("passes other paths", async () => {
    const h = await harness();
    expect((await h.call("/api/decisions")).out).toBe(PASS);
  });
});
