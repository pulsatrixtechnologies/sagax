// The bot zip routes (server/routes/bot-zip.ts): export streams a zip the
// upload reads back, the preview names what will happen, the import makes
// a new bot, a member's copy drops host settings, a person without the
// right is refused, and a staged file is the uploader's alone.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import { Store } from "../store.ts";
import { botPluginsWithMarketplaces } from "../testing/plugin-stores.ts";
import type { BotZipHost } from "../bot-zip.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { createBotZipRoutes, type BotZipAuditRow, type BotZipRouteDeps } from "./bot-zip.ts";
import { XaiMarketplaceError } from "../plugins/xai-marketplace.ts";
import type { XaiMarketplaceBot } from "../../shared/xai-marketplace.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
const dirs: string[] = [];
beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const person = (principalId: string): RequestAuth => ({
  kind: "session", via: "cookie", scopes: ["client"],
  session: { id: principalId, principalId, label: principalId, scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0 } as never,
});

async function boot(extra: Partial<BotZipRouteDeps> = {}) {
  const store = new Store(() => ({ instanceId: "fixture", model: "m" }));
  const plugins = botPluginsWithMarketplaces({ dataDir: DATA_DIR, gitEnvironment: () => ({}), policy: () => undefined });
  const host: BotZipHost = {
    store, dataDir: DATA_DIR, appVersion: "test", organization: true, routines: () => null, webhooks: () => null, plugins,
    marketplaceTokenSources: () => new Set(), emailOf: () => undefined, principalByEmail: () => undefined, mcpServer: () => undefined,
    engineUsable: () => true, defaultSelection: () => ({ instanceId: "fixture", model: "m" }), sectionExists: () => false,
  };
  const audit: BotZipAuditRow[] = [];
  const owner = "pr_00000000-0000-4000-8000-0000000000aa";
  const bot = store.createBot({ name: "Atlas", soul: "Be brief.", ownerUserId: owner }, { seedMessages: false });
  store.patchBot(bot.id, { computer: "local", browser: true, cwd: tmpdir() });
  const staging = mkdtempSync(join(tmpdir(), "sagax-zip-stage-"));
  dirs.push(staging);
  const routes = [createBotZipRoutes({
    host, stagingDir: staging,
    mayExport: (auth, botId) => auth.kind === "session" && store.bot(botId)?.ownerUserId === auth.session.principalId,
    importer: (auth) => auth.kind !== "session" ? null : {
      principalId: auth.session.principalId!, key: auth.session.principalId!,
      canCreate: auth.session.principalId !== "pr_readonly", asMember: auth.session.principalId !== owner,
    },
    audit: (_auth, row) => { audit.push(row); },
    ...extra,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const who = typeof req.headers["x-person"] === "string" ? req.headers["x-person"] : "";
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: person(who), json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { store, bot, owner, base, audit };
}

describe("bot zip routes", () => {
  it("exports, previews and imports; a member's copy keeps its computer and browser and drops the working folder", async () => {
    const { store, bot, owner, base, audit } = await boot();
    const refused = await fetch(`${base}/api/bots/${bot.id}/export.zip`, { headers: { "x-person": "pr_stranger" } });
    expect(refused.status).toBe(404);
    const download = await fetch(`${base}/api/bots/${bot.id}/export.zip?conversations=1`, { headers: { "x-person": owner } });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/zip");
    expect(download.headers.get("content-disposition")).toContain("atlas.sagaxbot.zip");
    const zip = Buffer.from(await download.arrayBuffer());
    expect(zip.subarray(0, 2).toString()).toBe("PK");
    expect(audit[0]).toMatchObject({ action: "bot.export", target: { id: bot.id } });

    const member = "pr_00000000-0000-4000-8000-0000000000bb";
    const upload = await fetch(`${base}/api/bots/import/upload`, { method: "POST", headers: { "x-person": member, "content-type": "application/zip" }, body: zip });
    expect(upload.status).toBe(200);
    const staged = await upload.json() as { id: string; preview: { importName: string; skipped: Array<{ part: string }> } };
    expect(staged.preview.importName).toBe("Atlas 2");
    expect(staged.preview.skipped.some((line) => line.part === "host")).toBe(true);
    // #1138: the computer and browser work in the member's own environment
    expect((staged.preview as { created?: Array<{ part: string; detail?: string }> }).created?.find((line) => line.part === "host")?.detail).toContain("Browser");

    // the staged file is the uploader's alone
    const other = await fetch(`${base}/api/bots/import/${staged.id}`, { method: "POST", headers: { "x-person": owner, "content-type": "application/json" }, body: "{}" });
    expect(other.status).toBe(404);

    const renamed = await fetch(`${base}/api/bots/import/${staged.id}/preview`, { method: "POST", headers: { "x-person": member, "content-type": "application/json" }, body: JSON.stringify({ name: "Mine" }) });
    expect((await renamed.json() as { preview: { importName: string } }).preview.importName).toBe("Mine");

    const imported = await fetch(`${base}/api/bots/import/${staged.id}`, { method: "POST", headers: { "x-person": member, "content-type": "application/json" }, body: JSON.stringify({ name: "Mine", conversations: true }) });
    expect(imported.status).toBe(201);
    const result = await imported.json() as { botId: string; name: string };
    expect(result.name).toBe("Mine");
    expect(store.bot(result.botId)).toMatchObject({ ownerUserId: member, browser: true, soul: "Be brief." });
    // This computer travels: it works in the member's own environment.
    expect(store.bot(result.botId)!.computer).toBe("local");
    // the working folder stays an admin's on the shared server
    expect(store.bot(result.botId)!.cwd).toBeUndefined();
    expect(audit.at(-1)).toMatchObject({ action: "bot.import", target: { id: result.botId, name: "Mine" }, after: { memberDefaults: true } });
    // used once
    const again = await fetch(`${base}/api/bots/import/${staged.id}`, { method: "POST", headers: { "x-person": member, "content-type": "application/json" }, body: "{}" });
    expect(again.status).toBe(404);
  });

  it("refuses a person who cannot create bots, and a file that is not a bot", async () => {
    const { base } = await boot();
    const readOnly = await fetch(`${base}/api/bots/import/upload`, { method: "POST", headers: { "x-person": "pr_readonly" }, body: Buffer.from("PK") });
    expect(readOnly.status).toBe(403);
    const junk = await fetch(`${base}/api/bots/import/upload`, { method: "POST", headers: { "x-person": "pr_x" }, body: Buffer.from("not a zip at all") });
    expect(junk.status).toBe(400);
    expect((await junk.json() as { code: string }).code).toBe("invalid_zip");
  });
});

describe("the phone's agent import (POST /api/bots/import/agent)", () => {
  const reply = JSON.stringify({
    format: "openmaus.grok/1", name: "Scout", description: "Finds leads.", instructions: "Find leads.",
    skills: [], routines: [{ name: "Daily", schedule: "every day at 9am", cron: "0 9 * * *", timeZone: "UTC", prompt: "Find leads." },
      { name: "On reply", schedule: "When a lead replies", cron: "", timeZone: "", prompt: "Read it." }],
    plugins: [], memories: [],
  });

  it("gives the export prompt, stages the reply as a package for this person, and lists what was left out", async () => {
    const { base } = await boot();
    const prompt = await fetch(`${base}/api/bots/import/agent`, { headers: { "x-person": "pr_member" } }).then((r) => r.json()) as { prompt: string };
    expect(prompt.prompt).toContain("openmaus.grok/1");
    const staged = await fetch(`${base}/api/bots/import/agent`, {
      method: "POST", headers: { "x-person": "pr_member", "content-type": "application/json" }, body: JSON.stringify({ text: reply, timeZone: "UTC" }),
    });
    expect(staged.status).toBe(200);
    const body = await staged.json() as { id: string; preview: { kind: string; name: string; includes: { routines: number } }; leftOut: Array<{ reasonKey?: string }> };
    expect(body.preview).toMatchObject({ kind: "legacy", name: "Scout", includes: { routines: 1 } });
    expect(body.leftOut.map((item) => item.reasonKey)).toEqual(["leftOut.reason.eventRoutine"]);
    // staged for this person only
    const other = await fetch(`${base}/api/bots/import/${body.id}/preview`, { method: "POST", headers: { "x-person": "pr_other", "content-type": "application/json" }, body: "{}" });
    expect(other.status).toBe(404);
  });

  it("refuses a reply that is not an export, and a person who may not create bots", async () => {
    const { base } = await boot();
    const bad = await fetch(`${base}/api/bots/import/agent`, { method: "POST", headers: { "x-person": "pr_member", "content-type": "application/json" }, body: JSON.stringify({ text: "hello" }) });
    expect(bad.status).toBe(400);
    const readOnly = await fetch(`${base}/api/bots/import/agent`, { method: "POST", headers: { "x-person": "pr_readonly", "content-type": "application/json" }, body: JSON.stringify({ text: reply }) });
    expect(readOnly.status).toBe(403);
  });
});

describe("the phone's xAI Bot Marketplace import (POST /api/bots/import/agent { marketplace })", () => {
  const sample: XaiMarketplaceBot = {
    slug: "sample-desk", name: "Sample Desk", creator: "Alex Example", description: "Writes a weekly brief.", categories: ["Sales"],
    color: "magenta", shape: "pebble", shareId: "AbCdEfGhIjKlMnOpQrStU", url: "https://x.ai/bot/marketplace/bots/sample-desk",
    instructions: "", memories: ["I keep a weekly brief."], skills: [{ name: "Weekly brief", description: "Write the brief." }],
    routines: [{ name: "Friday recap", summary: "Every Friday, what went out this week." }], integrations: [{ name: "notion-workspace", description: "Keep the brief." }],
  };
  const stage = (base: string, body: unknown) => fetch(`${base}/api/bots/import/agent`, {
    method: "POST", headers: { "x-person": "pr_member", "content-type": "application/json" }, body: JSON.stringify(body),
  });

  it("reads the bot on the server and stages it like a pasted agent reply", async () => {
    const { base } = await boot({ xaiMarketplaceBot: async (slug) => ({ ...sample, slug }) });
    const staged = await stage(base, { marketplace: "sample-desk", timeZone: "UTC" });
    expect(staged.status).toBe(200);
    const body = await staged.json() as { id: string; preview: { name: string; includes: { routines: number } }; leftOut: unknown[] };
    expect(body.preview).toMatchObject({ name: "Sample Desk", includes: { routines: 1 } });
    expect(body.leftOut).toEqual([]);
  });

  it("answers the source's own code when x.ai cannot be read, and 404 where the source is not offered", async () => {
    const down = await boot({ xaiMarketplaceBot: async () => { throw new XaiMarketplaceError("xai_unreachable"); } });
    const failed = await stage(down.base, { marketplace: "sample-desk" });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ code: "xai_unreachable" });
    const none = await boot();
    expect((await stage(none.base, { marketplace: "sample-desk" })).status).toBe(404);
  });
});
