import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLIENT_ALLOW } from "../auth/client-allow.ts";
import type { FeedbackService } from "../feedback/service.ts";
import { createFeedbackRoutes, parseFeedbackStart } from "./feedback.ts";
import { PASS } from "./table.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function call(path: string, method: string, body?: unknown) {
  const dataDir = mkdtempSync(join(tmpdir(), "fb-routes-"));
  dirs.push(dataDir);
  const started: unknown[] = [];
  const service = {
    start: (principal: string | null, request: unknown) => { started.push({ principal, request }); return { botId: "b1", threadId: "t1" }; },
    list: () => [],
  } as unknown as FeedbackService;
  const handler = createFeedbackRoutes({ dataDir, service, actorPrincipalId: () => "p1" });
  let sent: { status: number; body: any } | null = null;
  const run = (p: string, m: string, b?: unknown) => handler({
    req: {} as never, res: { setHeader() {} } as never, url: new URL(`http://x${p}`), path: p, method: m, auth: {} as never,
    json: (_res: unknown, status: number, out: unknown) => { sent = { status, body: out }; },
    readBody: async () => b,
  } as never);
  return { run: async () => { const out = await run(path, method, body); return { out, sent: sent as { status: number; body: any } | null }; }, again: async (p: string, m: string, b?: unknown) => { await run(p, m, b); return sent as { status: number; body: any } | null; }, started };
}

describe("feedback routes (#2618)", () => {
  it("keeps only known fields of a start request and caps their size", () => {
    const request = parseFeedbackStart({ source: "nope", platform: "ios", appVersion: "0.8.70", page: "x".repeat(500), clientLogs: ["a", 3, "b"], screenshot: "javascript:alert(1)", locale: "en", token: "leak" });
    expect(request).toMatchObject({ source: "menu", platform: "ios", appVersion: "0.8.70", clientLogs: ["a", "b"], locale: "en" });
    expect(request?.page).toHaveLength(120);
    expect(request).not.toHaveProperty("screenshot");
    expect(request).not.toHaveProperty("token");
    expect(parseFeedbackStart(null)).toBeNull();
  });

  it("keeps the words typed after /feedback, capped (#2955)", () => {
    expect(parseFeedbackStart({ source: "slash", platform: "web", text: "bug the routines are missing" })?.text).toBe("bug the routines are missing");
    expect(parseFeedbackStart({ source: "slash", platform: "web", text: "x".repeat(9000) })?.text?.length).toBe(4000);
    expect(parseFeedbackStart({ source: "slash", platform: "web", text: 7 })).not.toHaveProperty("text");
  });

  it("starts a report for the session person", async () => {
    const { run, started } = call("/api/feedback/start", "POST", { source: "sidebar", platform: "desktop" });
    const { sent } = await run();
    expect(sent).toEqual({ status: 200, body: { botId: "b1", threadId: "t1" } });
    expect(started).toEqual([{ principal: "p1", request: expect.objectContaining({ source: "sidebar" }) }]);
  });

  it("never sends the GitHub token back, and rejects a malformed repo", async () => {
    const { run, again } = call("/api/admin/feedback-config", "PUT", { repo: "acme/app", token: "ghp_secret_value" });
    const { sent } = await run();
    expect(sent?.status).toBe(200);
    expect(sent?.body).toMatchObject({ repo: "acme/app", tokenSet: true });
    expect(JSON.stringify(sent?.body)).not.toContain("ghp_secret_value");
    const read = await again("/api/admin/feedback-config", "GET");
    expect(JSON.stringify(read?.body)).not.toContain("ghp_secret_value");
    expect((await again("/api/admin/feedback-config", "PUT", { repo: "not a repo" }))?.status).toBe(400);
  });

  it("lets other routes through and opens only start and list to app sessions", async () => {
    const { run } = call("/api/other", "GET");
    expect((await run()).out).toBe(PASS);
    const allowed = (method: string, path: string) => CLIENT_ALLOW.some((rule) => rule.methods.includes(method) && rule.path.test(path));
    expect(allowed("POST", "/api/feedback/start")).toBe(true);
    expect(allowed("GET", "/api/feedback")).toBe(true);
    expect(allowed("GET", "/api/admin/feedback-config")).toBe(false);
    expect(allowed("PUT", "/api/admin/feedback-config")).toBe(false);
  });
});
