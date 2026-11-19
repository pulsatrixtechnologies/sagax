import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { BrowserRuntime, type BrowserSpawnSpec } from "./browser-runtime.ts";
import type { XAccount } from "../../shared/x-post.ts";

// A bot posts to X by driving a browser signed in to x.com. The runtime reads who the
// person is from the account menu of that page (demo data: nobody real).
const SIGNED_IN = `<nav><a data-testid="AppTabBar_Profile_Link" href="/sample"></a>
<button data-testid="SideNav_AccountSwitcher_Button"><div data-testid="UserAvatar-Container-sample"><img src="https://pbs.twimg.com/profile_images/1/sample_normal.jpg"></div>
<div><span>Sample Account</span><svg data-testid="icon-verified"></svg></div><div><span>@sample</span></div></button></nav><main>Compose</main>`;
const SIGNED_OUT = `<main><a href="/login">Sign in</a></main>`;

const ENGINE = String.raw`
const lines = require('node:readline').createInterface({ input: process.stdin });
const { Window } = require('happy-dom');
const win = new Window({ url: process.env.PAGE_URL, settings: { disableIframePageLoading: true } });
win.document.body.innerHTML = process.env.PAGE_HTML;
const text = (value) => ({ content: [{ type: 'text', text: value }] });
lines.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'notifications/initialized') return;
  let result;
  if (m.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} } };
  else if (m.method === 'tools/list') result = { tools: [{ name: 'agent_browser_snapshot' }] };
  else {
    const { name, arguments: args } = m.params;
    if (name === 'agent_browser_get_url') result = text(process.env.PAGE_URL);
    else if (name === 'agent_browser_eval') { try { result = text(JSON.stringify(win.eval(args.script))); } catch (error) { result = { isError: true, content: [{ type: 'text', text: 'Evaluation failed: ' + error.message }] }; } }
    else result = text('page text');
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n');
});
`;

const spec = (url: string, html: string): BrowserSpawnSpec => ({ command: process.execPath, args: ["-e", ENGINE], env: { PATH: process.env.PATH, PAGE_URL: url, PAGE_HTML: html, NODE_PATH: join(process.cwd(), "node_modules") } });
const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function run(url: string, html: string) {
  const seen: Array<{ session: string; account: XAccount }> = [];
  const browser = new BrowserRuntime({ requestTimeoutMs: 5_000, takeoverTimeoutMs: 100, idleMs: 5_000, onXAccount: (session, account) => seen.push({ session, account }) });
  cleanups.push(() => browser.closeAll());
  const call = (name: string) => browser.agentRpc("s", spec(url, html), "tools/call", { name, arguments: {} });
  return { seen, call };
}

describe("a bot's browser on a signed-in x.com page", () => {
  it("records the posting account (name, handle, badge, picture) from the page's own account menu", async () => {
    const { seen, call } = run("https://x.com/compose/post", SIGNED_IN);
    const answer = await call("agent_browser_snapshot");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ session: "s", account: { handle: "sample", name: "Sample Account", verified: true, avatarUrl: "https://pbs.twimg.com/profile_images/1/sample_normal.jpg" } });
    // what it read never reaches the bot
    expect(JSON.stringify(answer)).not.toContain("Sample Account");
  });

  it("reads nothing on another site, nor on x.com signed out", async () => {
    const elsewhere = run("https://shop.example.test/", SIGNED_IN);
    await elsewhere.call("agent_browser_snapshot");
    expect(elsewhere.seen).toHaveLength(0);
    const out = run("https://x.com/home", SIGNED_OUT);
    await out.call("agent_browser_snapshot");
    expect(out.seen).toHaveLength(0);
  });
});
