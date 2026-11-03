// Real check of the providers an organization hides (2026-10-18, the owner: "I have
// hidden providers from the Perspicax menu, but they are still visible in a
// lot of menus through Sagax"). An organization server with three engines
// (Claude, Codex and Grok, all fakes) and an admin signed in through the
// fake Perspicax; the built app in a headless Chromium. Each menu is shot
// before and after the admin hides Grok through the console API (the same
// POST /api/org/admin/settings Perspicax's Providers card sends), and the
// shots after must not offer Grok anywhere. The bot that ran on Grok moves
// to Auto and says so in its conversation. Isolated: temporary home and
// free ports, never ~/.sagax.
//
//   pnpm exec vite build
//   node --experimental-strip-types scripts/verify/dev/verify-org-hidden-providers.ts --shots DIR
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startFakeOidcProvider, type FakeOidcUser } from "../../../server/testing/fake-oidc-provider.ts";
import { freePortBlock } from "../../../server/testing/ports.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RESERVED = [18790, 5199, 8799];
const ADMIN: FakeOidcUser = { sub: "01J9VERIFYHIDDENPROVIDERS0A", email: "ada@example.test", name: "Ada", preferred_username: "ada", role: "admin" };
const shotsAt = process.argv.indexOf("--shots");
const shotsDir = shotsAt > 0 ? process.argv[shotsAt + 1]! : join(ROOT, ".shots");
mkdirSync(shotsDir, { recursive: true });

const FAKE_CLAUDE = join(ROOT, "server", "testing", "fake-claude-cli.ts");
const FAKE_ACP = join(ROOT, "server", "testing", "fake-acp-cli.ts");
const FAKE_CODEX = join(ROOT, "server", "testing", "fake-codex-app-server.ts");
for (const cli of [FAKE_CLAUDE, FAKE_ACP, FAKE_CODEX]) chmodSync(cli, 0o755);

const idp = await startFakeOidcProvider({ user: ADMIN });
idp.directoryPeople = [idp.personOf(ADMIN)];
const port = await freePortBlock([0, 1]);
if (RESERVED.includes(port) || RESERVED.includes(port + 1)) throw new Error("reserved port, run again");
const origin = `http://127.0.0.1:${port}`;
const home = mkdtempSync(join(tmpdir(), "omb-verify-hidden-providers-"));
mkdirSync(join(home, ".sagax"), { recursive: true });
writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({
  // the welcome flow is done: the menus are what is shot
  onboarding: { completedAt: "2026-10-18T00:00:00.000Z", version: 999 },
  instances: {
    claude: { driver: "claudeAgent", config: { cli: FAKE_CLAUDE, fullAuto: true } },
    codex: { driver: "codex", config: { cli: FAKE_CODEX, fullAuto: false } },
    grok: { driver: "grokAgent", config: { cli: FAKE_ACP, fullAuto: false } },
  },
}));
mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
  version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin, link_token: idp.linkToken,
}), { mode: 0o640 });
let serverLog = "";
const server: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server", "index.ts")], {
  cwd: ROOT,
  env: {
    PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
    SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: idp.issuer, SAGAX_PUBLIC_URL: origin, SAGAX_STATIC_DIR: join(ROOT, "dist"),
    SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"), SAGAX_PERSPICAX_DIRECTORY_SECONDS: "5", SAGAX_ORG_NAME: "Acme",
    // the organization pays for Claude, OpenAI and xAI (placeholders: no turn runs)
    SAGAX_ANTHROPIC_API_KEY: "sk-ant-verify-placeholder", SAGAX_OPENAI_API_KEY: "sk-verify-placeholder", XAI_API_KEY: "xai-verify-placeholder",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout!.on("data", (c) => (serverLog += c));
server.stderr!.on("data", (c) => (serverLog += c));
let failed = false;
const fail = (line: string) => { failed = true; console.log(`[verify] FAIL: ${line}`); };
try {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${serverLog}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const pair = (setCookie: string) => setCookie.split(";")[0]!;
  const start = await fetch(`${origin}/auth/oidc/start`, { redirect: "manual" });
  const binding = pair(start.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
  const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
  if (!session) throw new Error(`no session:\n${serverLog.slice(-2000)}`);
  const cookie = pair(session);
  const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = { cookie }) => {
    const res = await fetch(`${origin}${path}`, { method, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, text };
  };
  // the engines start: wait until all three list their models
  type Row = { instanceId: string; models: { default: string; options: Array<{ id: string }> } };
  let rows: Row[] = [];
  for (let i = 0; i < 150; i++) {
    rows = ((await api("GET", "/api/instances")).body?.instances ?? []) as Row[];
    if (["claude", "codex", "grok"].every((id) => rows.some((row) => row.instanceId === id && row.models.default))) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const modelOf = (id: string) => rows.find((row) => row.instanceId === id)?.models.default ?? "";
  console.log(`[verify] organization server ${origin}; engines ${rows.map((row) => `${row.instanceId}:${row.models.default}`).join(", ")}`);
  // Atlas runs on Grok, the provider the admin will hide.
  const created = await api("POST", "/api/bots", { name: "Atlas" });
  if (created.status !== 201) throw new Error(`bot: ${created.text}`);
  const atlas = created.body.bot as { id: string; threadId: string };
  const patched = await api("PATCH", `/api/bots/${atlas.id}`, { modelSelection: { instanceId: "grok", model: modelOf("grok") } });
  if (patched.status !== 200) throw new Error(`model: ${patched.text}`);

  const { chromium } = await import("playwright");
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  const favorites = JSON.stringify([["grok", modelOf("grok")], ["claude", modelOf("claude")]]);
  const shoot = async (phase: "before" | "after") => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, locale: "fr-CA" });
    await context.addCookies([{ name: cookie.split("=")[0]!, value: cookie.slice(cookie.indexOf("=") + 1), url: origin }]);
    await context.addInitScript((value) => {
      try {
        localStorage.setItem("sagax.modelFavorites.v1", value);
        localStorage.setItem("sagax.locale", "fr");
      } catch { /* a fresh profile */ }
    }, favorites);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const shot = async (name: string) => { await page.waitForTimeout(500); await page.screenshot({ path: join(shotsDir, `${phase}-${name}.png`) }); };
    const grokOffered = async (where: string) => {
      const found = await page.locator('[data-rail-provider="grok"], [data-model-provider="grok"], [data-model-section="grok"], [data-rail-provider="xaiApi"], [data-model-provider="xaiApi"], [data-model-section="xaiApi"]').count();
      if (phase === "after" && found > 0) fail(`${where}: Grok is still offered`);
      if (phase === "before" && found === 0) console.log(`[verify] note: ${where} shows no Grok row before (layout)`);
    };
    await page.goto(`${origin}/`);
    // open Atlas's conversation
    await page.getByText("Atlas", { exact: true }).first().click({ timeout: 30_000 });
    await page.waitForSelector('[data-tour="model"]', { timeout: 30_000 });
    // the catalogs load (the chip then names the model, not its id)
    await page.waitForTimeout(5_000);
    const toast = page.locator('button[aria-label="Fermer"], button[aria-label="Close"]');
    for (const close of await toast.all()) await close.click({ timeout: 1_000 }).catch(() => {});
    if (phase === "after") {
      await shot("conversation");
      if ((await page.getByText("n'offre plus").count()) === 0) fail("the moved bot's line is not in its conversation");
    }
    // 1. the composer's model menu, its providers and its favorites
    await page.click('[data-tour="model"]');
    await page.waitForSelector("[data-model-menu]", { timeout: 10_000 });
    await shot("composer-menu");
    const all = page.locator("[data-model-all-group] [role=menuitem], [data-model-all-group] button").first();
    if (await all.count()) { await all.click(); await shot("composer-menu-providers"); }
    await grokOffered("composer menu");
    const favoritesText = await page.locator("[data-model-favorites]").innerText().catch(() => "");
    if (phase === "after" && /grok/i.test(favoritesText)) fail("a Grok favorite is still shown");
    // 2. the menu's search
    await page.fill("[data-model-search]", "grok");
    await shot("composer-search");
    if (phase === "after" && (await page.locator("[data-model-no-match]").count()) === 0) fail("the search still finds a Grok model");
    await page.fill("[data-model-search]", "");
    // 3. the model window (Edit…)
    await page.click("[data-model-edit]");
    await page.waitForSelector("[data-model-picker-content]", { timeout: 10_000 });
    await shot("model-window");
    await grokOffered("model window");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    // 4. Settings > Models, through the command palette
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    await page.waitForTimeout(400);
    await page.keyboard.type("Modèles");
    await page.waitForTimeout(400);
    await page.keyboard.press("Enter");
    try {
      await page.waitForSelector("[data-models-voice]", { timeout: 10_000 });
      await shot("settings-models");
      const cards = await page.locator("[data-models-voice]").innerText();
      if (phase === "after" && /\bGrok\b(?! voice| Voice| images)/.test(cards.replace(/Grok (voix|images)/gi, ""))) fail("Settings > Models still lists Grok");
    } catch {
      await shot("settings-models-failed");
      console.log("[verify] note: Settings > Models did not open from the palette");
    }
    await page.keyboard.press("Escape");
    await context.close();
    if (errors.length) console.log(`[verify] ${phase} page errors: ${errors.join(" | ")}`);
  };
  await shoot("before");
  // The admin hides Grok in Perspicax: the console API, as its Providers card sends it.
  const bearer = idp.consoleAssertion({ sub: ADMIN.sub, aud: origin, role: "admin", teams: [] });
  const hidden = await api("POST", "/api/org/admin/settings", { allowedEngines: ["claude", "claudeApi", "codex", "openai"] }, { authorization: `Bearer ${bearer}` });
  if (hidden.status !== 200) throw new Error(`hide: ${hidden.text}`);
  const listed = ((await api("GET", "/api/instances")).body.instances as Row[]).map((row) => row.instanceId);
  if (listed.includes("grok")) fail(`GET /api/instances still lists grok (${listed.join(", ")})`);
  const moved = (await api("GET", "/api/bots")).body.bots.find((bot: { id: string }) => bot.id === atlas.id);
  if (moved?.modelSelection?.instanceId === "grok") fail("Atlas is still on Grok");
  console.log(`[verify] Atlas now on ${JSON.stringify(moved?.modelSelection)}`);
  await shoot("after");
  // Solo stays unchanged: covered by shared/offered-engines.test.ts and ModelPicker.interaction.test.ts.
  await browser.close();
} finally {
  server.kill("SIGTERM");
  await idp.close();
}
console.log(failed ? "[verify] FAILED" : `[verify] OK, shots in ${shotsDir}`);
process.exit(failed ? 1 : 0);
