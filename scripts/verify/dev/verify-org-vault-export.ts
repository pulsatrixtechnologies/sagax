// Real check of the organization's vault export policy (2026-10-18). An
// organization server (fake Claude, fake Perspicax) with an admin signed in;
// the built app in a headless Chromium. Settings > Organization and Settings
// > Credentials are shot, then the admin turns vault exports off through
// the console API (the same POST /api/org/admin/settings Perspicax sends)
// and both pages are shot again: Export must be disabled with the reason,
// and the server must refuse the export. With --phase before (a build
// without the setting), only the first shots are taken. Isolated:
// temporary home and free ports, never ~/.sagax. Fake values only.
//
//   pnpm exec vite build
//   node --experimental-strip-types scripts/verify/dev/verify-org-vault-export.ts --shots DIR [--phase before]
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startFakeOidcProvider, type FakeOidcUser } from "../../../server/testing/fake-oidc-provider.ts";
import { freePortBlock } from "../../../server/testing/ports.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RESERVED = [18790, 5199, 8799];
const ADMIN: FakeOidcUser = { sub: "01J9VERIFYVAULTEXPORTPOLICY0", email: "ada@example.test", name: "Ada", preferred_username: "ada", role: "admin" };
const arg = (name: string) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : undefined; };
const shotsDir = arg("--shots") ?? join(ROOT, ".shots");
const phase = arg("--phase") === "before" ? "before" : "after";
mkdirSync(shotsDir, { recursive: true });

const FAKE_CLAUDE = join(ROOT, "server", "testing", "fake-claude-cli.ts");
chmodSync(FAKE_CLAUDE, 0o755);

const idp = await startFakeOidcProvider({ user: ADMIN });
idp.directoryPeople = [idp.personOf(ADMIN)];
const port = await freePortBlock([0, 1]);
if (RESERVED.includes(port) || RESERVED.includes(port + 1)) throw new Error("reserved port, run again");
const origin = `http://127.0.0.1:${port}`;
const home = mkdtempSync(join(tmpdir(), "omb-verify-vault-export-"));
mkdirSync(join(home, ".sagax"), { recursive: true });
writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({
  onboarding: { completedAt: "2026-10-18T00:00:00.000Z", version: 999 },
  instances: { claude: { driver: "claudeAgent", config: { cli: FAKE_CLAUDE, fullAuto: true } } },
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
    SAGAX_ANTHROPIC_API_KEY: "sk-ant-verify-placeholder", SAGAX_MCP_OAUTH_KEY: randomBytes(32).toString("hex"),
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
  const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = { cookie, origin }) => {
    const res = await fetch(`${origin}${path}`, { method, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, body: parsed, text };
  };
  const item = await api("POST", "/api/me/credentials", { kind: "login", name: "Portail démo", username: "ada@example.test", password: "fake-pass-verify-1", domains: ["portal.example.test"] });
  if (item.status !== 201) throw new Error(`vault item: ${item.text}`);

  const { chromium } = await import("playwright");
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  const shoot = async (label: string) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, locale: "fr-CA" });
    await context.addCookies([{ name: cookie.split("=")[0]!, value: cookie.slice(cookie.indexOf("=") + 1), url: origin }]);
    await context.addInitScript(() => { try { localStorage.setItem("sagax.locale", "fr"); } catch { /* a fresh profile */ } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(`${origin}/`);
    await page.waitForTimeout(4_000);
    const open = async (query: string, ready: string) => {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
      await page.waitForTimeout(400);
      // the palette opens Settings; the section is picked in its side list
      await page.keyboard.type("Réglages");
      await page.waitForTimeout(500);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1_000);
      await page.getByRole("button", { name: query, exact: true }).first().click({ timeout: 10_000 });
      try {
        await page.waitForSelector(ready, { timeout: 15_000 });
      } catch (error) {
        await page.screenshot({ path: join(shotsDir, `${label}-failed-${query}.png`) });
        throw error;
      }
      await page.waitForTimeout(800);
    };
    await open("Organisation", "[data-settings-card]");
    const policy = page.locator('[data-settings-card="organization.memberAutoApproval"]');
    if (await policy.count()) await policy.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shotsDir, `${label}-organization.png`) });
    const switchState = await page.locator("[data-org-vault-export]").getAttribute("data-org-vault-export").catch(() => null);
    console.log(`[verify] ${label}: Settings > Organization vault export switch: ${switchState ?? "absent"}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await open("Identifiants", "[data-credentials-settings]");
    await page.screenshot({ path: join(shotsDir, `${label}-credentials.png`) });
    const exportButton = page.locator("[data-credentials-export]");
    const disabled = await exportButton.isDisabled();
    const reason = await page.locator("[data-credentials-export-blocked]").innerText().catch(() => "");
    console.log(`[verify] ${label}: Export disabled=${disabled} reason=${JSON.stringify(reason)}`);
    await context.close();
    if (errors.length) console.log(`[verify] ${label} page errors: ${errors.join(" | ")}`);
    return { disabled, reason, switchState };
  };
  const first = await shoot(phase === "before" ? "before" : "after-allowed");
  if (first.disabled) fail("Export is disabled while exports are allowed");
  if (phase === "after") {
    if (first.switchState !== "on") fail("the Settings > Organization switch is not on by default");
    const bearer = idp.consoleAssertion({ sub: ADMIN.sub, aud: origin, role: "admin", teams: [] });
    const off = await api("POST", "/api/org/admin/settings", { allowVaultExport: false }, { authorization: `Bearer ${bearer}` });
    if (off.status !== 200) throw new Error(`policy: ${off.text}`);
    const refused = await api("POST", "/api/me/credentials/export", { format: "chrome-csv", acknowledge: "plaintext" });
    if (refused.status !== 403 || refused.body?.code !== "export_blocked_by_org") fail(`export not refused: ${refused.status} ${refused.text}`);
    if (refused.text.includes("fake-pass-verify-1")) fail("the refusal carries a value");
    console.log(`[verify] export after the policy: ${refused.status} ${refused.body?.code}`);
    const blocked = await shoot("after-blocked");
    if (!blocked.disabled) fail("Export is still enabled once the organization turned exports off");
    if (!blocked.reason) fail("Settings > Credentials does not say why Export is off");
    if (blocked.switchState !== "off") fail("the Settings > Organization switch does not show off");
  }
  await browser.close();
} finally {
  server.kill("SIGTERM");
  await idp.close();
}
console.log(failed ? "[verify] FAILED" : `[verify] OK, shots in ${shotsDir}`);
process.exit(failed ? 1 : 0);
