// Real check of the first-run engine step on an organization server
// (2026-10-18, the owner: "Si aucun LLM/moteur fonctionnel n'est présent lors de la
// première connexion en organisation, il faut que le setup de ton premier
// compte soit dans le setup initial, comme on fait en mode sans serveur").
//
// Three organization servers, each with Claude, Codex and Grok (fakes), the
// fake Perspicax and a member (Noor) signing in for the first time; the
// built app in a headless Chromium, light and dark:
//
//   none     the organization allows no engine (allowedEngines []): the
//            step says to contact the admin (Ada) by name.
//   connect  engines allowed, nothing given to Noor, no account of his: the
//            step lists the allowed engines to connect his own. Noor opens
//            Claude's sign-in (up to the provider's page), then keeps his
//            own Anthropic key in Perspicax, checks again, and his first
//            turn answers.
//   ready    the organization gives Noor Claude on its key: no step, no
//            notice, the chat answers as before.
//
// Isolated: temporary homes and free ports, never ~/.sagax.
//
//   pnpm exec vite build
//   node --experimental-strip-types scripts/verify/dev/verify-org-engine-onboarding.ts --shots DIR [--phase before|after]
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startFakeOidcProvider, type FakeOidcUser } from "../../../server/testing/fake-oidc-provider.ts";
import { freePortBlock } from "../../../server/testing/ports.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RESERVED = [18790, 5199, 8799];
const ADMIN: FakeOidcUser = { sub: "01J9VERIFYORGENGINESADMIN0A", email: "ada@example.test", name: "Ada Lovelace", preferred_username: "ada", role: "admin" };
const MEMBER: FakeOidcUser = { sub: "01J9VERIFYORGENGINESMEMBER", email: "noor@example.test", name: "Noor", preferred_username: "noor", role: "employee" };
const arg = (name: string) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const phase = arg("--phase") === "before" ? "before" : "after";
const shotsDir = arg("--shots") ?? join(ROOT, ".shots", phase);
mkdirSync(shotsDir, { recursive: true });
const only = arg("--case");

const FAKE_CLAUDE = join(ROOT, "server", "testing", "fake-claude-cli.ts");
const FAKE_ACP = join(ROOT, "server", "testing", "fake-acp-cli.ts");
const FAKE_CODEX = join(ROOT, "server", "testing", "fake-codex-app-server.ts");
for (const cli of [FAKE_CLAUDE, FAKE_ACP, FAKE_CODEX]) chmodSync(cli, 0o755);

let failed = false;
const fail = (line: string) => { failed = true; console.log(`[verify] FAIL: ${line}`); };
const note = (line: string) => console.log(`[verify] ${line}`);

type CaseId = "none" | "connect" | "ready";
interface CaseSetup { allowedEngines?: string[]; serverEngines: string[] }
const CASES: Record<CaseId, CaseSetup> = {
  none: { allowedEngines: [], serverEngines: [] },
  connect: { serverEngines: [] },
  ready: { serverEngines: ["claude"] },
};

const { chromium } = await import("playwright");
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});

async function runCase(id: CaseId, setup: CaseSetup) {
  const idp = await startFakeOidcProvider({ user: MEMBER });
  idp.directoryPeople = [idp.personOf(ADMIN), { ...idp.personOf(MEMBER), sagax_server_engines: setup.serverEngines }];
  const port = await freePortBlock([0, 1]);
  if (RESERVED.includes(port) || RESERVED.includes(port + 1)) throw new Error("reserved port, run again");
  const origin = `http://127.0.0.1:${port}`;
  const home = mkdtempSync(join(tmpdir(), `omb-verify-org-engines-${id}-`));
  mkdirSync(join(home, ".sagax"), { recursive: true });
  writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({
    // the workspace's welcome flow is the admin's, done long ago
    onboarding: { completedAt: "2026-10-18T00:00:00.000Z", version: 999 },
    ...(setup.allowedEngines ? { organization: { allowedEngines: setup.allowedEngines } } : {}),
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
      SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: idp.issuer, SAGAX_PUBLIC_URL: origin, SAGAX_STATIC_DIR: process.env.VERIFY_DIST ?? join(ROOT, "dist"),
      SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"), SAGAX_PERSPICAX_DIRECTORY_SECONDS: "5", SAGAX_ORG_NAME: "Acme",
      // the organization pays for Claude and xAI (placeholders for the fakes)
      SAGAX_ANTHROPIC_API_KEY: "sk-ant-verify-placeholder", XAI_API_KEY: "xai-verify-placeholder",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout!.on("data", (c) => (serverLog += c));
  server.stderr!.on("data", (c) => (serverLog += c));
  try {
    const deadline = Date.now() + 90_000;
    for (;;) {
      try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch { /* not yet */ }
      if (Date.now() > deadline) throw new Error(`server never came up:\n${serverLog.slice(-3000)}`);
      await new Promise((r) => setTimeout(r, 300));
    }
    const pair = (setCookie: string) => setCookie.split(";")[0]!;
    const start = await fetch(`${origin}/auth/oidc/start`, { redirect: "manual" });
    const binding = pair(start.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
    const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
    const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
    const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
    if (!session) throw new Error(`no session:\n${serverLog.slice(-2000)}`);
    const cookie = pair(session);
    const api = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`${origin}${path}`, { method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      let parsed: unknown = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
      return { status: res.status, body: parsed as any, text };
    };
    // the directory (Noor's engines) arrives
    for (let i = 0; i < 60; i++) {
      const engines = (await api("GET", "/api/me/engines")).body?.engines ?? [];
      if (setup.allowedEngines?.length === 0 || engines.length > 0) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    const mine = (await api("GET", "/api/me/engines")).body?.engines ?? [];
    note(`${id}: ${origin}; Noor's engines ${mine.map((e: any) => `${e.instanceId}:${e.myTurns}`).join(", ") || "(none)"}`);
    // Noor's own bot
    const created = await api("POST", "/api/bots", { name: "Atlas" });
    if (created.status !== 201) note(`${id}: Noor could not create a bot (${created.status} ${created.text.slice(0, 200)})`);

    for (const scheme of ["dark", "light"] as const) {
      // the step opens by itself once per person (the preference travels), so
      // the second theme opens it from the chat's notice
      const firstVisit = scheme === "dark";
      // the skin travels with the person: set it on the server for this theme
      await api("PATCH", "/api/me/preferences", { set: { "omb-skin": scheme === "light" ? "pulsatrix-light" : "pulsatrix" }, remove: [] });
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, locale: "fr-CA", colorScheme: scheme });
      await context.addCookies([{ name: cookie.split("=")[0]!, value: cookie.slice(cookie.indexOf("=") + 1), url: origin }]);
      await context.addInitScript((skin) => {
        try { localStorage.setItem("sagax.locale", "fr"); localStorage.setItem("omb-language", "fr"); localStorage.setItem("omb-skin", skin); } catch { /* fresh profile */ }
      }, scheme === "light" ? "pulsatrix-light" : "pulsatrix");
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      const shot = async (name: string) => { await page.waitForTimeout(600); await page.screenshot({ path: join(shotsDir, `${id}-${scheme}-${name}.png`) }); };
      await page.goto(`${origin}/`);
      await page.waitForTimeout(6_000);
      const toast = page.locator('button[aria-label="Fermer"], button[aria-label="Close"]');
      for (const close of await toast.all()) await close.click({ timeout: 1_000 }).catch(() => {});
      const gate = page.locator("[data-org-engine-setup]");
      if (phase === "after" && !firstVisit && id !== "ready" && !(await gate.count())) {
        await page.getByText("Atlas", { exact: true }).first().click({ timeout: 10_000 }).catch(() => {});
        await page.locator("[data-org-engine-notice-connect]").click({ timeout: 10_000 }).catch(() => {});
        if (id === "none") note("none: the blocked notice has no connect button (by design); light shot is the chat notice");
        await page.waitForTimeout(800);
      }
      await shot("first-run");
      if (phase === "after") {
        if (id === "ready") {
          if (await gate.count()) fail(`${id}: the step opened although Claude answers Noor`);
          if (await page.locator("[data-org-engine-notice]").count()) fail(`${id}: the chat shows the notice although Claude answers Noor`);
        } else {
          if (firstVisit && !(await gate.count())) fail(`${id}/${scheme}: the step did not open at first run`);
        }
        if (id === "none" && firstVisit) {
          if (!(await page.locator('[data-org-engines="blocked"]').count())) fail(`${id}: not the admin message`);
          const admins = await page.locator("[data-org-engines-admins]").innerText().catch(() => "");
          if (!admins.includes("Ada Lovelace")) fail(`${id}: the admin is not named (${admins})`);
        }
        if (id === "connect") {
          const rows = await page.locator("[data-org-engine-row]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-org-engine-row")));
          note(`${id}: rows offered ${rows.join(", ")}`);
          if (!rows.includes("claude")) fail(`${id}: Claude is not offered to connect`);
        }
      }
      if (scheme === "light" && phase === "after" && id === "connect") {
        // up to the provider's page: Claude's own sign-in
        const connect = page.locator('[data-org-engine-row="claude"] [data-engine-connect-button] button').first();
        if (await connect.count()) {
          const popup = context.waitForEvent("page", { timeout: 15_000 }).catch(() => null);
          await connect.click();
          await page.waitForTimeout(4_000);
          await shot("claude-sign-in");
          const opened = await popup;
          if (opened) {
            note(`${id}: Claude sign-in opened ${opened.url().slice(0, 80)}`);
            await opened.close().catch(() => {});
          } else {
            const link = await page.locator('[data-org-engine-row="claude"] a[href^="https://"]').first().getAttribute("href").catch(() => null);
            note(`${id}: Claude sign-in link ${link ? link.slice(0, 80) : "(none drawn)"}`);
          }
        } else {
          note(`${id}: no Connect Claude button drawn`);
        }
        let ready = (await page.locator('[data-org-engines="ready"]').count()) > 0;
        if (ready) note(`${id}: Noor's own Claude sign-in finished (fake provider): the step says ready`);
        // otherwise Noor keeps his own Anthropic key in Perspicax, then checks again
        if (!ready) idp.providerKeys.set(`${MEMBER.sub}/anthropic`, "sk-ant-noor-own-placeholder");
        for (let i = 0; i < 20 && !ready; i++) {
          await page.waitForTimeout(1_500);
          await page.locator("[data-org-engines-recheck]").first().click().catch(() => {});
          await page.waitForTimeout(1_500);
          ready = (await page.locator('[data-org-engines="ready"]').count()) > 0;
        }
        await shot("connected");
        if (!ready) fail(`${id}: the step never saw Noor's own key`);
        await page.locator("[data-org-engine-setup] [data-primary]").first().click().catch(() => {});
        await page.waitForTimeout(1_000);
        await shot("chat-after-connect");
        if (await page.locator("[data-org-engine-notice]").count()) fail(`${id}: the notice stays after connecting`);
      } else if (phase === "after" && id !== "ready" && firstVisit) {
        // "Later" (or Continue): the chat says so and leads back
        await page.locator("[data-org-engine-setup] [data-primary]").first().click().catch(() => {});
        await page.waitForTimeout(1_000);
        await page.getByText("Atlas", { exact: true }).first().click({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(1_500);
        await shot("chat-notice");
        if (!(await page.locator(`[data-org-engine-notice="${id === "none" ? "blocked" : "connect"}"]`).count())) fail(`${id}/${scheme}: the chat has no notice`);
        if (id === "connect") {
          await page.locator("[data-org-engine-notice-connect]").click();
          await page.waitForTimeout(800);
          if (!(await gate.count())) fail(`${id}: the notice's button does not open the step`);
          await shot("notice-reopens-step");
          await page.keyboard.press("Escape");
        }
      }
      // a first turn (light only): the reply, or the silent failure before the fix
      if (scheme === "light" && (id !== "connect" || phase === "before" || !failed)) {
        await page.getByText("Atlas", { exact: true }).first().click({ timeout: 10_000 }).catch(() => {});
        const input = page.locator("textarea").first();
        if (await input.count()) {
          await input.fill("Bonjour, peux-tu répondre ?");
          await input.press("Enter");
          await page.waitForTimeout(10_000);
          await shot("first-turn");
        } else note(`${id}: no composer drawn`);
      }
      await context.close();
      if (errors.length) note(`${id}/${scheme} page errors: ${errors.join(" | ").slice(0, 600)}`);
    }
    if (id !== "none") {
      const bots = (await api("GET", "/api/bots")).body?.bots ?? [];
      const atlas = bots.find((bot: any) => bot.name === "Atlas");
      if (atlas) {
        const thread = await api("GET", `/api/bots/${atlas.id}/messages?limit=20`);
        note(`${id}: Atlas thread ${thread.status} ${thread.text.slice(0, 400).replace(/\s+/g, " ")}`);
      }
    }
  } finally {
    server.kill("SIGTERM");
    await idp.close();
  }
}

try {
  for (const [id, setup] of Object.entries(CASES) as Array<[CaseId, CaseSetup]>) {
    if (only && only !== id) continue;
    await runCase(id, setup);
  }
} finally {
  await browser.close();
}
console.log(failed ? "[verify] FAILED" : `[verify] OK (${phase}), shots in ${shotsDir}`);
process.exit(failed ? 1 : 0);
