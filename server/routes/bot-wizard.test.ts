// The wizard's draft routes, through the route table on a real HTTP server,
// over a real draft store in a throwaway folder.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { createBotWizardStore } from "../bot-wizard-store.ts";
import { requiredScope } from "../auth/request-auth.ts";
import { createBotWizardRoutes, type BotWizardBot } from "./bot-wizard.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

async function serve(options: { generate?: (prompt: string) => Promise<string>; owner?: string; mayChange?: (botId: string) => boolean } = {}) {
  const folder = mkdtempSync(join(tmpdir(), "omb-bot-wizard-"));
  folders.push(folder);
  const drafts = createBotWizardStore(folder);
  const bots = new Map<string, BotWizardBot>([
    ["bot-1", { id: "bot-1", name: "Tri", title: "Email triage", description: "Trie ma boîte de réception." }],
    ["bot-2", { id: "bot-2", name: "Other", title: "", description: "" }],
  ]);
  const prompts: string[] = [];
  let clock = 1_000;
  const routes = [createBotWizardRoutes({
    drafts,
    principal: () => options.owner ?? "pr_me",
    bot: (id) => bots.get(id),
    mayChange: (_auth, botId) => options.mayChange?.(botId) ?? true,
    generate: () => options.generate ? async (prompt) => { prompts.push(prompt); return options.generate!(prompt); } : null,
    now: () => ++clock,
    timeoutMs: 500,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, {
      req, res, url, path: url.pathname, method: req.method ?? "GET",
      auth: { kind: "loopback", scopes: ["admin", "client"] }, json, readBody,
    });
    if (!handled) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  return { call, folder, prompts };
}

describe("/api/bot-wizard", () => {
  it("starts, resumes, patches and finishes a draft kept on disk", async () => {
    const { call, folder } = await serve();
    const started = await call("PUT", "/api/bot-wizard/bot-1", { origin: "new", mode: "manual", roleId: "inbox" });
    expect(started.status).toBe(201);
    expect(started.body.draft).toMatchObject({ botId: "bot-1", owner: "pr_me", origin: "new", mode: "manual", step: "identity", roleId: "inbox", status: "draft", botName: "Tri" });

    const patched = await call("PATCH", "/api/bot-wizard/bot-1", { step: "soul", answers: { tone: "Calme" }, rules: { "ask-send-mail": "rule-9" }, routines: ["inbox-triage"] });
    expect(patched.body.draft).toMatchObject({ step: "soul", answers: { tone: "Calme" }, rules: { "ask-send-mail": "rule-9" }, routines: ["inbox-triage"] });

    // the other app starts the same bot again: it resumes, in its own mode, nothing lost
    const resumed = await call("PUT", "/api/bot-wizard/bot-1", { origin: "new", mode: "guided" });
    expect(resumed.status).toBe(200);
    expect(resumed.body.draft).toMatchObject({ mode: "guided", step: "soul", answers: { tone: "Calme" }, rules: { "ask-send-mail": "rule-9" } });

    const listed = await call("GET", "/api/bot-wizard");
    expect(listed.body.drafts.map((draft: { botId: string }) => draft.botId)).toEqual(["bot-1"]);

    const read = await call("GET", "/api/bot-wizard/bot-1?language=fr");
    expect(read.body.suggestions.rules.map((rule: { id: string }) => rule.id)).toEqual(["ask-send-mail", "deny-delete-mail", "deny-payment"]);
    expect(read.body.suggestions.rules[0].when).toBe("envoyer un courriel");
    expect(read.body.suggestions.tools).toEqual(["apps", "mcp"]);

    const finished = await call("POST", "/api/bot-wizard/bot-1/finish", {});
    expect(finished.body.draft.status).toBe("done");
    expect((await call("GET", "/api/bot-wizard")).body.drafts).toEqual([]);

    const file = join(folder, "bot-wizard-drafts.json");
    expect(JSON.parse(readFileSync(file, "utf8")).drafts["bot-1"].status).toBe("done");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("redo starts prefilled from the last run; restart replaces an open one", async () => {
    const { call } = await serve();
    await call("PUT", "/api/bot-wizard/bot-1", { origin: "new", mode: "manual" });
    await call("PATCH", "/api/bot-wizard/bot-1", { answers: { tone: "x" } });
    await call("POST", "/api/bot-wizard/bot-1/finish", {});
    const redo = await call("PUT", "/api/bot-wizard/bot-1", { origin: "redo", mode: "manual" });
    expect(redo.status).toBe(201);
    // prefilled from the last run: answers kept, routines not picked again
    expect(redo.body.draft).toMatchObject({ origin: "redo", status: "draft", step: "identity", answers: { tone: "x" }, routines: [] });
    await call("PATCH", "/api/bot-wizard/bot-1", { answers: { tone: "y" } });
    const restarted = await call("PUT", "/api/bot-wizard/bot-1", { origin: "redo", mode: "guided", restart: true });
    expect(restarted.body.draft).toMatchObject({ answers: { tone: "y" }, step: "identity", mode: "guided" });
    const fresh = await call("PUT", "/api/bot-wizard/bot-1", { origin: "redo", mode: "guided", restart: true, roleId: "coder" });
    expect(fresh.body.draft).toMatchObject({ roleId: "coder", answers: { tone: "" } });
  });

  it("refuses a bad patch and a bot the caller may not change; DELETE forgets the draft", async () => {
    const { call } = await serve({ mayChange: (botId) => botId === "bot-1" });
    expect((await call("PATCH", "/api/bot-wizard/bot-1", { step: "soul" })).status).toBe(404);
    await call("PUT", "/api/bot-wizard/bot-1", { origin: "new", mode: "manual" });
    expect((await call("PATCH", "/api/bot-wizard/bot-1", { step: "nowhere" })).status).toBe(400);
    expect((await call("PATCH", "/api/bot-wizard/bot-1", { owner: "pr_other" })).status).toBe(400);
    expect((await call("PUT", "/api/bot-wizard/bot-2", { origin: "new", mode: "manual" })).status).toBe(404);
    expect((await call("PUT", "/api/bot-wizard/missing", { origin: "new", mode: "manual" })).status).toBe(404);
    expect((await call("DELETE", "/api/bot-wizard/bot-1")).body).toEqual({ ok: true });
    expect((await call("GET", "/api/bot-wizard/bot-1")).status).toBe(404);
  });

  it("lists only the caller's own drafts", async () => {
    const mine = await serve({ owner: "pr_me" });
    await mine.call("PUT", "/api/bot-wizard/bot-1", { origin: "new", mode: "manual" });
    expect((await mine.call("GET", "/api/bot-wizard")).body.drafts).toHaveLength(1);
  });

  it("writes the soul with the bot's model, else from the answers", async () => {
    const withModel = await serve({ generate: async () => "Tu es Tri — calme." });
    await withModel.call("PUT", "/api/bot-wizard/bot-1", { origin: "new", mode: "manual", roleId: "inbox" });
    await withModel.call("PATCH", "/api/bot-wizard/bot-1", { answers: { tone: "Calme" } });
    const written = await withModel.call("POST", "/api/bot-wizard/bot-1/soul", { language: "fr" });
    expect(written.body).toEqual({ soul: "Tu es Tri, calme.", source: "model" });
    expect(withModel.prompts[0]).toContain("Tone: Calme");

    const failing = await serve({ generate: () => new Promise(() => {}) });
    await failing.call("PUT", "/api/bot-wizard/bot-1", { origin: "new", mode: "manual" });
    await failing.call("PATCH", "/api/bot-wizard/bot-1", { answers: { tone: "Calme" } });
    const fallback = await failing.call("POST", "/api/bot-wizard/bot-1/soul", { language: "fr" });
    expect(fallback.body.source).toBe("answers");
    expect(fallback.body.soul).toBe("Tu es Tri : Trie ma boîte de réception.\n\n## Ton\n\nCalme");
  });

  it("serves the kits and leaves other paths to the next handler", async () => {
    const { call } = await serve();
    const kits = await call("GET", "/api/bot-wizard/kits?language=fr");
    expect(kits.body.kits.map((kit: { id: string }) => kit.id)).toEqual(["assistant", "inbox", "research", "coder", "community", "ops", "subscriptions"]);
    expect((await call("GET", "/api/bots")).body).toEqual({ from: "inline routes" });
  });

  it("is open to a member's client session, never admin only", () => {
    expect(requiredScope("GET", "/api/bot-wizard")).toBe("client");
    expect(requiredScope("GET", "/api/bot-wizard/kits")).toBe("client");
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) expect(requiredScope(method, "/api/bot-wizard/bot-1")).toBe("client");
    expect(requiredScope("POST", "/api/bot-wizard/bot-1/soul")).toBe("client");
    expect(requiredScope("POST", "/api/bot-wizard/bot-1/finish")).toBe("client");
  });
});
