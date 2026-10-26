// A sign-in to a fake site in a real headless browser: a local HTTP server
// with a one-step and a two-step login page, a login in a fixture vault, and
// the bot signing in through fill_credential (field login) with the handle
// only. Everything the bot sees (the runtime's results), and everything the
// process logs meanwhile, is checked for the values and their encodings; the
// site checks that the sign-in really happened. A throwaway headless Chromium
// from Playwright's cache drives the page (never a person's own Chrome); the
// test is skipped where that cache is absent (the account's own home: the
// test setup moves HOME). Every value is fake.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { vaultHandle } from "../shared/credential-vault.ts";
import { BrowserRuntime, type BrowserSpawnSpec, type CredentialFillAccess } from "./browser-runtime.ts";
import { variants } from "./credential-fill.ts";
import { CredentialVault, fillResolverFor, LOCAL_VAULT_PRINCIPAL } from "./credential-vault.ts";

const FAKE_USER = "e2e.fake.user@example.test";
const FAKE_PASSWORD = "fake-E2E-Pa55-site-login";
const WRONG_PASSWORD = "fake-E2E-wrong-Pa55-xyz";

const HEADLESS = process.env.SAGAX_TEST_HEADLESS_SHELL
  ?? join(userInfo().homedir, "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(HEADLESS);

// The engine: agent-browser's MCP tools over stdio, backed by Playwright and
// a headless shell with a throwaway profile. Closed with its stdin.
const PLAYWRIGHT_ENGINE = String.raw`
const { chromium } = require('playwright');
const lines = require('node:readline').createInterface({ input: process.stdin });
const text = (value) => ({ content: [{ type: 'text', text: value }] });
const failure = (message) => ({ isError: true, content: [{ type: 'text', text: message }] });
const ready = (async () => { const browser = await chromium.launch({ headless: true, executablePath: process.env.HEADLESS_SHELL, timeout: 30000 }); const page = await browser.newPage(); return { browser, page }; })();
let queue = Promise.resolve();
async function run(name, args) {
  const { page } = await ready;
  if (name === 'agent_browser_get_url') return text(page.url());
  if (name === 'agent_browser_open') { await page.goto(args.url); return text('opened ' + args.url); }
  if (name === 'agent_browser_eval') { try { return text(JSON.stringify(await page.evaluate(args.script))); } catch (error) { return failure('Evaluation failed: ' + error.message); } }
  if (name === 'agent_browser_snapshot') {
    const body = await page.evaluate('document.body ? document.body.innerText : ""');
    const fields = await page.evaluate('JSON.stringify(Array.from(document.querySelectorAll("input")).map((el) => "textbox " + (el.name || el.id) + " value=\\"" + el.value + "\\""))');
    return text(body + '\n' + JSON.parse(fields).join('\n'));
  }
  if (name === 'agent_browser_get_text') return text(await page.content());
  if (name === 'agent_browser_click') { try { await page.click(args.selector, { timeout: 3000 }); return text('clicked'); } catch (error) { return failure(error.message); } }
  if (name === 'agent_browser_screenshot') return { content: [{ type: 'image', data: (await page.screenshot()).toString('base64'), mimeType: 'image/png' }] };
  return failure('unknown ' + name);
}
lines.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'notifications/initialized') return;
  queue = queue.then(async () => {
    let result;
    if (m.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} } };
    else if (m.method === 'tools/list') result = { tools: [{ name: 'agent_browser_snapshot' }] };
    else result = await run(m.params.name, m.params.arguments || {});
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n');
  });
});
lines.on('close', async () => { try { (await ready).browser.close(); } catch {} process.exit(0); });
`;

// The fake site. It keeps what it received so the test can tell a real
// sign-in from a claimed one; nothing of it reaches the bot but the pages.
interface FakeSite { url: string; posts: Array<{ path: string; fields: Record<string, string> }>; signedIn: number; close(): Promise<void> }

function page(body: string): string {
  return `<!doctype html><html><head><title>Fake site</title></head><body>${body}</body></html>`;
}
const ONE_STEP = (alert = "") => page(`${alert ? `<p role="alert">${alert}</p>` : ""}<form method="post" action="/session"><input name="user" type="email" autocomplete="username"><input name="pass" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>`);
const STEP_USER = page('<form method="post" action="/two/next"><input name="user" type="email" autocomplete="username"><button type="submit">Next</button></form>');
const STEP_PASS = (alert = "") => page(`${alert ? `<p role="alert">${alert}</p>` : ""}<form method="post" action="/two/session"><input name="pass" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>`);

async function fakeSite(): Promise<FakeSite> {
  const posts: FakeSite["posts"] = [];
  const pending = new Map<string, string>();
  const sessions = new Set<string>();
  let signedIn = 0;
  const cookie = (req: IncomingMessage, name: string) => (req.headers.cookie ?? "").split(/;\s*/).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
  const send = (res: ServerResponse, status: number, html: string, headers: Record<string, string> = {}) => { res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers }); res.end(html); };
  const redirect = (res: ServerResponse, to: string, headers: Record<string, string> = {}) => { res.writeHead(303, { location: to, ...headers }); res.end(); };
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    let raw = "";
    req.on("data", (chunk: Buffer) => { raw += chunk.toString("utf8"); });
    req.on("end", () => {
      if (req.method === "POST") posts.push({ path, fields: Object.fromEntries(new URLSearchParams(raw)) });
      const fields = Object.fromEntries(new URLSearchParams(raw));
      const open = (res2: ServerResponse) => { const sid = Math.random().toString(36).slice(2); sessions.add(sid); signedIn++; redirect(res2, "/dashboard", { "set-cookie": `sid=${sid}; HttpOnly; Path=/` }); };
      if (req.method === "GET" && path === "/login") return send(res, 200, ONE_STEP());
      if (req.method === "POST" && path === "/session") return fields.user === FAKE_USER && fields.pass === FAKE_PASSWORD ? open(res) : send(res, 200, ONE_STEP("Wrong user name or password"));
      if (req.method === "GET" && path === "/two/login") return send(res, 200, STEP_USER);
      if (req.method === "POST" && path === "/two/next") { const id = Math.random().toString(36).slice(2); pending.set(id, fields.user ?? ""); return redirect(res, "/two/password", { "set-cookie": `pending=${id}; HttpOnly; Path=/` }); }
      if (req.method === "GET" && path === "/two/password") return send(res, 200, STEP_PASS());
      if (req.method === "POST" && path === "/two/session") return pending.get(cookie(req, "pending")) === FAKE_USER && fields.pass === FAKE_PASSWORD ? open(res) : send(res, 200, STEP_PASS("Wrong password"));
      if (req.method === "GET" && path === "/dashboard") return sessions.has(cookie(req, "sid")) ? send(res, 200, page("<h1>Dashboard</h1><p>You are signed in.</p>")) : redirect(res, "/login");
      send(res, 404, page("Not found"));
    });
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return {
    url: `http://localhost:${(server.address() as AddressInfo).port}`,
    posts,
    get signedIn() { return signedIn; },
    close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }),
  };
}

type ToolResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };

describe.skipIf(!available)("signing in to a fake site in a headless browser (e2e)", () => {
  const cleanups: Array<() => unknown> = [];
  let site: FakeSite;
  let other: FakeSite;
  // Everything the process prints while the bot works: no value may appear.
  const printed: string[] = [];
  const restore: Array<() => void> = [];

  beforeAll(async () => {
    site = await fakeSite();
    other = await fakeSite();
    for (const stream of [process.stdout, process.stderr]) {
      const write = stream.write.bind(stream);
      stream.write = ((chunk: unknown, ...rest: unknown[]) => { printed.push(String(chunk)); return (write as (...args: unknown[]) => boolean)(chunk, ...rest); }) as typeof stream.write;
      restore.push(() => { stream.write = write; });
    }
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      const original = console[level];
      console[level] = (...args: unknown[]) => { printed.push(args.map(String).join(" ")); original(...args); };
      restore.push(() => { console[level] = original; });
    }
  });
  afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
  afterAll(async () => {
    for (const undo of restore.splice(0)) undo();
    expectClean(printed);
    await site?.close();
    await other?.close();
  });

  function setup(password = FAKE_PASSWORD) {
    const dir = mkdtempSync(join(tmpdir(), "sagax-login-e2e-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const vault = new CredentialVault(dir, () => ({ kind: "key", key: Buffer.alloc(32, 9) }));
    const item = vault.create(LOCAL_VAULT_PRINCIPAL, { kind: "login", name: "Fake site", username: FAKE_USER, password, domains: [site.url] });
    vault.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-e2e", mode: "always" });
    const runtime = new BrowserRuntime({ requestTimeoutMs: 45_000, takeoverTimeoutMs: 100, idleMs: 60_000, loginSettleMs: 8_000, loginPollMs: 150 });
    cleanups.push(() => runtime.closeAll());
    const spec: BrowserSpawnSpec = { command: process.execPath, args: ["-e", PLAYWRIGHT_ENGINE], env: { PATH: process.env.PATH, HOME: dir, HEADLESS_SHELL: HEADLESS, NODE_PATH: join(process.cwd(), "node_modules") } };
    const access = fillResolverFor(vault, { principalId: LOCAL_VAULT_PRINCIPAL, botId: "bot-e2e", threadId: "t-e2e" });
    const seen: ToolResult[] = [];
    const tool = async (session: string, name: string, args: Record<string, unknown>, credentials: CredentialFillAccess | undefined = access) => {
      const result = await runtime.agentRpc(session, spec, "tools/call", { name, arguments: args }, undefined, credentials) as ToolResult;
      seen.push(result);
      return result;
    };
    return { handle: vaultHandle(item.id), tool, seen, vault, item };
  }

  function expectClean(seen: unknown[]): void {
    const text = JSON.stringify(seen);
    for (const secret of [FAKE_USER, FAKE_PASSWORD, WRONG_PASSWORD]) {
      for (const variant of variants(secret)) expect(text, `a form of a value leaked: ${variant.slice(0, 3)}...`).not.toContain(variant);
    }
  }

  it("signs in on a one-step page with the handle only, and the bot sees no value", async () => {
    const { handle, tool, seen } = setup();
    const before = site.signedIn;
    expect((await tool("one", "agent_browser_open", { url: `${site.url}/login` })).isError).toBeUndefined();
    const result = await tool("one", "fill_credential", { credential: handle, field: "login" });
    expect(result.isError, result.content[0]?.text).toBeUndefined();
    expect(result.content[0]!.text).toContain(`submitted it; the page is now ${site.url}/dashboard`);
    expect(site.signedIn).toBe(before + 1);
    const snapshot = await tool("one", "agent_browser_snapshot", {});
    expect(snapshot.content[0]!.text).toContain("You are signed in.");
    // After a fill: no script and no screenshot for the bot.
    expect((await tool("one", "agent_browser_eval", { script: "document.cookie" })).isError).toBe(true);
    expect((await tool("one", "agent_browser_screenshot", {})).isError).toBe(true);
    expectClean(seen);
  }, 120_000);

  it("goes through a two-step sign-in (user name, Next, password) in one call", async () => {
    const { handle, tool, seen } = setup();
    const before = site.signedIn;
    await tool("two", "agent_browser_open", { url: `${site.url}/two/login` });
    const result = await tool("two", "fill_credential", { credential: handle, field: "login" });
    expect(result.isError, result.content[0]?.text).toBeUndefined();
    expect(result.content[0]!.text).toContain("Filled the user name and password");
    expect(result.content[0]!.text).toContain(`${site.url}/dashboard`);
    expect(site.signedIn).toBe(before + 1);
    expect(site.posts.filter((post) => post.path === "/two/next")).toHaveLength(1);
    expectClean(seen);
  }, 120_000);

  it("stops at a refused login, says what the site said, and sends the password once", async () => {
    const { handle, tool, seen } = setup(WRONG_PASSWORD);
    const before = site.posts.filter((post) => post.path === "/session").length;
    await tool("wrong", "agent_browser_open", { url: `${site.url}/login` });
    const result = await tool("wrong", "fill_credential", { credential: handle, field: "login" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("did not accept");
    expect(result.content[0]!.text).toContain("Wrong user name or password");
    expect(site.posts.filter((post) => post.path === "/session").length).toBe(before + 1);
    expectClean(seen);
  }, 120_000);

  it("fills nothing on another site, even with the same form", async () => {
    const { handle, tool, seen } = setup();
    await tool("other", "agent_browser_open", { url: `${other.url}/login` });
    const result = await tool("other", "fill_credential", { credential: handle, field: "login" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("is only filled on");
    expect(other.posts).toHaveLength(0);
    const snapshot = await tool("other", "agent_browser_snapshot", {});
    expect(snapshot.content[0]!.text).toContain('textbox pass value=""');
    expectClean(seen);
  }, 120_000);
});
