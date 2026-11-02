// Characterization of GET /api/decisions and /api/decisions.csv.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { appendDecision, flushDecisionLog } from "../decision-log.ts";
import { createDecisionsRoutes } from "./decisions.ts";
import { PASS } from "./table.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function harness() {
  const dataDir = mkdtempSync(join(tmpdir(), "sagax-decisions-"));
  dirs.push(dataDir);
  appendDecision(dataDir, {
    decision: "user-approved",
    source: "user",
    threadId: "t1",
    botId: "b1",
    botName: "Bot",
    tool: "Bash",
    summary: "ls",
    actor: { kind: "session", sessionId: "s1", label: "Ada", email: "ada@example.test" },
  });
  await flushDecisionLog(dataDir);
  const route = createDecisionsRoutes({ dataDir });
  const call = async (pathWithQuery: string, method = "GET") => {
    const path = pathWithQuery.split("?")[0]!;
    const sent: Array<{ status: number; body: unknown }> = [];
    let ended: string | undefined;
    let head: { status: number; headers: Record<string, string | number | readonly string[] | undefined> } | undefined;
    const out = await route({
      req: { headers: {} } as never,
      res: {
        writeHead: (status: number, headers: Record<string, string>) => { head = { status, headers }; },
        end: (body?: string) => { ended = body; },
        setHeader: () => undefined,
      } as never,
      url: new URL(`http://localhost${pathWithQuery}`),
      path,
      method,
      auth: { kind: "loopback", scopes: ["admin"] } as never,
      json: ((_: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as never,
      readBody: (async () => ({})) as never,
    });
    return { out, sent: sent[0], head, ended };
  };
  return { call };
}

describe("GET /api/decisions", () => {
  it("lists decisions and refuses a bad limit", async () => {
    const h = await harness();
    const bad = await h.call("/api/decisions?limit=0");
    expect(bad.sent).toEqual({ status: 400, body: { error: "limit must be a positive whole number" } });
    const ok = await h.call("/api/decisions?limit=10");
    expect(ok.sent?.status).toBe(200);
    const body = ok.sent?.body as { decisions: unknown[] };
    expect(Array.isArray(body.decisions)).toBe(true);
    expect(body.decisions.length).toBeGreaterThanOrEqual(1);
  });

  it("exports CSV over a date range and refuses a bad range", async () => {
    const h = await harness();
    const bad = await h.call("/api/decisions.csv?from=nope&to=2026-11-01");
    expect(bad.sent).toEqual({
      status: 400,
      body: { error: "from and to must be YYYY-MM-DD, from no later than to, at most a year apart" },
    });
    const today = new Date().toISOString().slice(0, 10);
    const csv = await h.call(`/api/decisions.csv?from=${today}&to=${today}`);
    expect(csv.head?.status).toBe(200);
    expect(String(csv.head?.headers["content-type"])).toContain("text/csv");
    expect(csv.ended).toContain("time");
  });

  it("passes other paths", async () => {
    const h = await harness();
    expect((await h.call("/api/admin-activity")).out).toBe(PASS);
  });
});
