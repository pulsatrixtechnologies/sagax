// My Chrome end to end, against a throwaway headless Chrome (temporary
// profile, --headless=new, its own loopback DevTools port) and two local
// sites: never the person's Chrome or profile, never a window.
//
// The gate is what an engine reaches. These tests speak to it the way
// agent-browser does (raw DevTools), and the person's side is a second,
// direct connection to the test Chrome (their own tabs, their Stop click).
// With SAGAX_TEST_AGENT_BROWSER set to an agent-browser binary, the last
// suite also drives the bot's real tool path: refusals, approval cards and
// Stop through the browser runtime.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { removeTempDir } from "../../testing/cleanup.ts";
import { agentBrowserIntegration, closeBrowserSession, prepareBrowserSessionState } from "../../browser-engine.ts";
import { BrowserRuntime, browserRuntimeEnv } from "../../browser-runtime.ts";
import { MyChromeGate, PILOT_BANNER_ID } from "./gate.ts";
import { MyChromeMemory, runMyChromeTool } from "./pilot.ts";
import { MyChromeService } from "./service.ts";
import { hasShellOnThisComputer, MY_CHROME_SHELL_NOTE } from "./shell.ts";
import { myChromeSiteAllows } from "./sites.ts";
import { CdpClient, waitFor } from "./testing/cdp-client.ts";
import { startFakeSites, type FakeSites } from "./testing/fake-sites.ts";
import { findTestChrome, launchTestChrome, type TestChrome } from "./testing/test-chrome.ts";

const CHROME = findTestChrome();
const AGENT_BROWSER = process.env.SAGAX_TEST_AGENT_BROWSER ?? "";

describe.skipIf(!CHROME)("My Chrome gate on a headless test Chrome", () => {
  let chrome: TestChrome;
  let sites: FakeSites;
  let person: CdpClient;
  let allowed: string[];
  let gate: MyChromeGate;
  let bot: CdpClient;
  let stops = 0;
  let personTabs: string[] = [];

  beforeAll(async () => {
    chrome = await launchTestChrome(CHROME!);
    sites = await startFakeSites();
    // The person's own tabs: one on another site (it sets a cookie), one on the allowed site.
    person = await CdpClient.connect(chrome.wsUrl);
    for (const url of [`${sites.other}/?via=person`, `${sites.allowed}/?via=person`]) {
      const { targetId } = await person.send("Target.createTarget", { url, background: true });
      personTabs.push(String(targetId));
    }
    await waitFor(() => sites.otherHits.includes("/?via=person") && sites.allowedHits.includes("/?via=person"), 10_000, "the person's tabs");
  }, 60_000);

  afterAll(async () => {
    person?.close();
    await sites?.close();
    await chrome?.close();
  }, 30_000);

  beforeEach(async () => {
    allowed = [sites.allowed];
    stops = 0;
    gate = new MyChromeGate({
      resolveChrome: async () => chrome.wsUrl,
      allows: (url) => myChromeSiteAllows(allowed, url),
      onStopFromTab: () => { stops += 1; },
    });
    await gate.start();
    bot = await CdpClient.connect(gate.urlFor("bot-a"));
  });

  afterEach(async () => {
    bot?.close();
    await gate?.close();
  });

  /** Open a tab through the gate the way agent-browser does, and attach to it. */
  async function botTab(url = `${sites.allowed}/`): Promise<{ targetId: string; sessionId: string }> {
    const { targetId } = await bot.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await bot.send("Target.attachToTarget", { targetId, flatten: true });
    await bot.send("Page.enable", {}, String(sessionId));
    await bot.send("Runtime.enable", {}, String(sessionId));
    await bot.send("Page.navigate", { url }, String(sessionId));
    await waitFor(async () => (await bot.evaluate<string>(String(sessionId), "document.readyState")) === "complete", 10_000, "page load");
    return { targetId: String(targetId), sessionId: String(sessionId) };
  }

  it("shows the engine none of the person's tabs and refuses to attach to them", async () => {
    const { targetInfos } = await bot.send("Target.getTargets");
    expect(targetInfos).toEqual([]);
    await bot.send("Target.setDiscoverTargets", { discover: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(bot.events.filter((event) => event.method === "Target.targetCreated")).toEqual([]);
    for (const targetId of personTabs) {
      await expect(bot.send("Target.attachToTarget", { targetId, flatten: true })).rejects.toThrow(/not one this bot opened/);
      await expect(bot.send("Target.closeTarget", { targetId })).rejects.toThrow(/not one this bot opened/);
    }
    await expect(bot.send("Target.attachToBrowserTarget")).rejects.toThrow(/refuses/);
    await expect(bot.send("Target.createBrowserContext")).rejects.toThrow(/refuses/);
    await expect(bot.send("Target.setAutoAttach", { autoAttach: true, flatten: true, waitForDebuggerOnStart: false })).rejects.toThrow(/refuses/);
  });

  it("refuses every cookie, storage and browser-wide call, in the browser and in its own tab", async () => {
    for (const method of ["Network.getAllCookies", "Storage.getCookies", "Browser.close", "Browser.grantPermissions", "SystemInfo.getInfo", "Browser.getBrowserCommandLine"]) {
      await expect(bot.send(method)).rejects.toThrow(/refuses/);
    }
    const { sessionId } = await botTab();
    const refused: Array<[string, Record<string, unknown>]> = [
      ["Network.getAllCookies", {}],
      ["Network.getCookies", { urls: [sites.other] }],
      ["Network.getCookies", {}],
      ["Network.setCookie", { name: "x", value: "y", url: sites.other }],
      ["Network.deleteCookies", { name: "other_secret", url: sites.other }],
      ["Network.clearBrowserCookies", {}],
      ["Network.loadNetworkResource", { url: sites.other, options: { disableCache: true, includeCredentials: true } }],
      ["Network.getResponseBody", { requestId: "1" }],
      ["Storage.getCookies", {}],
      ["Storage.clearDataForOrigin", { origin: sites.other, storageTypes: "all" }],
      ["DOMStorage.getDOMStorageItems", { storageId: { securityOrigin: sites.other, isLocalStorage: true } }],
      ["IndexedDB.requestDatabaseNames", { securityOrigin: sites.other }],
      ["CacheStorage.requestCacheNames", { securityOrigin: sites.other }],
      ["Page.getCookies", {}],
      ["Fetch.enable", {}],
      ["DOM.setFileInputFiles", { files: ["/etc/hosts"] }],
      ["Target.createTarget", { url: "about:blank" }],
      ["Autofill.trigger", { fieldId: 1 }],
      ["Browser.close", {}],
    ];
    for (const [method, params] of refused) {
      await expect(bot.send(method, params, sessionId), method).rejects.toThrow(/refuses/);
    }
    // What the page itself may read stays the allowed site's own.
    const cookies = await bot.evaluate<string>(sessionId, "document.cookie");
    expect(cookies).toContain("allowed_session=mine");
    expect(cookies).not.toContain("other_secret");
    expect(cookies).not.toContain("other_script");
  });

  it("opens only the allowed sites: no tab, address, link, redirect or popup reaches another site", async () => {
    await expect(bot.send("Target.createTarget", { url: `${sites.other}/?via=create` })).rejects.toThrow(/blocked/);
    const { targetId, sessionId } = await botTab();
    await expect(bot.send("Page.navigate", { url: `${sites.other}/?via=navigate` }, sessionId)).rejects.toThrow(/blocked/);
    for (const id of ["other", "away"]) {
      await bot.evaluate(sessionId, `document.getElementById(${JSON.stringify(id)}).click()`);
      await waitFor(async () => (await person.send("Target.getTargetInfo", { targetId })).targetInfo !== undefined, 2_000);
      await new Promise((resolve) => setTimeout(resolve, 600));
      // The guard refused the document: the tab shows Chrome's error page.
      const href = await bot.evaluate<string>(sessionId, "location.href");
      expect(href.startsWith(sites.other) && !href.startsWith("chrome-error")).toBe(false);
      await bot.send("Page.navigate", { url: `${sites.allowed}/` }, sessionId);
      await waitFor(async () => (await bot.evaluate<string>(sessionId, "location.href").catch(() => "")) === `${sites.allowed}/`, 10_000, "back on the allowed site");
    }
    await bot.evaluate(sessionId, `window.open(${JSON.stringify(`${sites.other}/?via=popup`)})`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(sites.otherHits.filter((hit) => /via=(create|navigate|link|redirect|popup)/.test(hit))).toEqual([]);
    expect(sites.allowedHits).toContain("/away");
    expect(gate.takeNotes("bot-a").some((note) => note.includes(sites.other))).toBe(true);
  });

  it("refuses a back step to a site that is no longer allowed, before the page is restored", async () => {
    allowed = [sites.allowed, sites.other];
    const { sessionId } = await botTab();
    await bot.send("Page.navigate", { url: `${sites.other}/?via=history` }, sessionId);
    await waitFor(async () => (await bot.evaluate<string>(sessionId, "location.href").catch(() => "")).startsWith(sites.other), 10_000, "the other site");
    await bot.send("Page.navigate", { url: `${sites.allowed}/two` }, sessionId);
    await waitFor(async () => (await bot.evaluate<string>(sessionId, "location.href").catch(() => "")) === `${sites.allowed}/two`, 10_000, "page two");
    allowed = [sites.allowed];
    const history = await bot.send("Page.getNavigationHistory", {}, sessionId) as { entries: Array<{ id: number; url: string }> };
    const target = history.entries.find((entry) => entry.url.startsWith(sites.other));
    expect(target).toBeTruthy();
    const hitsBefore = sites.otherHits.length;
    await expect(bot.send("Page.navigateToHistoryEntry", { entryId: target!.id }, sessionId)).rejects.toThrow(/blocked/);
    expect(await bot.evaluate<string>(sessionId, "location.href")).toBe(`${sites.allowed}/two`);
    expect(sites.otherHits.length).toBe(hitsBefore);
    // An entry on an allowed site still works.
    const back = history.entries.find((entry) => entry.url === `${sites.allowed}/`);
    if (back) await bot.send("Page.navigateToHistoryEntry", { entryId: back.id }, sessionId);
  }, 60_000);

  it("keeps the banner on screen when the page tries to hide it", async () => {
    const { sessionId } = await botTab();
    // The page's own world: a stylesheet and a style change aimed at the banner.
    await bot.evaluate(sessionId, `(() => {
      const style = document.createElement("style");
      style.textContent = "sagax-pilot, #${PILOT_BANNER_ID} { display: none !important; visibility: hidden !important; opacity: 0 !important; }";
      document.head.appendChild(style);
      const host = document.getElementById(${JSON.stringify(PILOT_BANNER_ID)});
      if (host) { host.style.setProperty("display", "none", "important"); host.hidden = true; host.className = "x"; }
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const shown = await bot.evaluate<string>(sessionId, `(() => {
      const host = document.getElementById(${JSON.stringify(PILOT_BANNER_ID)});
      if (!host) return "missing";
      const css = getComputedStyle(host);
      const box = host.getBoundingClientRect();
      return [css.display, css.visibility, css.opacity, box.width > 0 && box.height > 0].join(",");
    })()`);
    expect(shown).toBe("block,visible,1,true");
  }, 60_000);

  it("keeps frames and workers of another site away from the engine, and strips every header", async () => {
    await bot.send("Target.setDiscoverTargets", { discover: true });
    const { targetId } = await bot.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await bot.send("Target.attachToTarget", { targetId, flatten: true });
    const session = String(sessionId);
    await bot.send("Network.enable", {}, session);
    await bot.send("Page.enable", {}, session);
    await bot.send("Target.setAutoAttach", { autoAttach: true, flatten: true, waitForDebuggerOnStart: true }, session);
    await bot.send("Page.navigate", { url: `${sites.allowed}/` }, session);
    await waitFor(() => sites.otherHits.includes("/?via=frame"), 10_000, "the other site's frame to load");
    await new Promise((resolve) => setTimeout(resolve, 800));
    const attached = bot.events.filter((event) => event.method === "Target.attachedToTarget");
    expect(attached.map((event) => String((event.params.targetInfo as { url?: string }).url ?? ""))).not.toContainEqual(expect.stringContaining(sites.other));
    const network = bot.events.filter((event) => event.method.startsWith("Network."));
    expect(network.length).toBeGreaterThan(0);
    expect(network.some((event) => event.method.endsWith("ExtraInfo"))).toBe(false);
    const text = JSON.stringify(network);
    expect(text).not.toContain("other_secret");
    expect(text).not.toContain("allowed_session");
    expect(text.toLowerCase()).not.toContain("set-cookie");
  });

  it("revoking a site stops the engine on it at once", async () => {
    const { sessionId } = await botTab();
    expect(await bot.evaluate<string>(sessionId, "document.title")).toBe("Allowed");
    allowed = [];
    await expect(bot.evaluate(sessionId, "document.title")).rejects.toThrow(/not one of the sites/);
  });

  it("shows a banner in the bot's tab, hidden from its snapshot; the person's Stop click there ends everything", async () => {
    const { targetId, sessionId } = await botTab();
    const tree = JSON.stringify(await bot.send("Accessibility.getFullAXTree", {}, sessionId));
    expect(tree).not.toMatch(/driving this tab|pilote cet onglet/);
    // The person's view of the same tab.
    const { sessionId: own } = await person.send("Target.attachToTarget", { targetId, flatten: true });
    const personSession = String(own);
    expect(await person.evaluate<boolean>(personSession, `!!document.getElementById(${JSON.stringify(PILOT_BANNER_ID)})`)).toBe(true);
    // A script of the page cannot press it.
    await person.evaluate(personSession, `(() => { const host = document.getElementById(${JSON.stringify(PILOT_BANNER_ID)}); host.click(); host.dispatchEvent(new MouseEvent("click", { bubbles: true })); })()`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(gate.stopped).toBe(false);
    // The person's real click on Stop (a trusted input event).
    const box = await person.evaluate<{ x: number; y: number }>(personSession, `(() => { const r = document.getElementById(${JSON.stringify(PILOT_BANNER_ID)}).getBoundingClientRect(); return { x: r.right - 18, y: r.top + r.height / 2 }; })()`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await person.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 }, personSession);
    }
    await waitFor(() => gate.stopped && bot.closed, 5_000, "Stop from the tab");
    expect(stops).toBe(1);
    await waitFor(async () => !(await person.evaluate<boolean>(personSession, `!!document.getElementById(${JSON.stringify(PILOT_BANNER_ID)})`)), 5_000, "the banner to go");
    await expect(CdpClient.connect(gate.urlFor("bot-a"))).rejects.toThrow(/403/);
    await person.send("Target.detachFromTarget", { sessionId: personSession });
  });

  it("Stop in Sagax cuts the engine off at once, and nothing connects until resume", async () => {
    const { sessionId } = await botTab();
    const started = Date.now();
    await gate.stop();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(bot.closed).toBe(true);
    await expect(bot.send("Runtime.evaluate", { expression: "1" }, sessionId)).rejects.toThrow(/closed/);
    expect(gate.status()).toMatchObject({ stopped: true, connected: false, clients: [] });
    await expect(CdpClient.connect(gate.urlFor("bot-a"))).rejects.toThrow(/403/);
    gate.resume();
    bot = await CdpClient.connect(gate.urlFor("bot-a"));
    await botTab();
    expect(gate.status().clients[0]?.tabs[0]?.url).toBe(`${sites.allowed}/`);
  });

  it("refuses a connection without its random path", async () => {
    const url = new URL(gate.urlFor("bot-a"));
    await expect(CdpClient.connect(`ws://${url.host}/devtools/browser/${"0".repeat(48)}`)).rejects.toThrow(/403/);
    await expect(CdpClient.connect(`ws://${url.host}/json/version`)).rejects.toThrow();
  });
});

describe.skipIf(!CHROME || !AGENT_BROWSER)("My Chrome through agent-browser and the bot's tool path", () => {
  let chrome: TestChrome;
  let sites: FakeSites;
  let gate: MyChromeGate;
  let runtime: BrowserRuntime;
  const session = "mychrome-e2e";
  const cards: string[] = [];
  let answer: "allow" | "deny" = "deny";
  const memory = new MyChromeMemory();
  let spec: ReturnType<typeof agentBrowserIntegration>;

  beforeAll(async () => {
    chrome = await launchTestChrome(CHROME!);
    sites = await startFakeSites();
    gate = new MyChromeGate({ resolveChrome: async () => chrome.wsUrl, allows: (url) => myChromeSiteAllows([sites.allowed], url) });
    await gate.start();
    // The test runner's HOME is a throwaway folder: the engine's sockets and
    // managed config go there.
    spec = agentBrowserIntegration({
      binaryPath: AGENT_BROWSER, session, encryptionKey: "test-key", persistent: false,
      env: process.env, attachCdpUrl: gate.urlFor(session),
    });
    await prepareBrowserSessionState(AGENT_BROWSER, session, { env: spec.env, persistent: false });
    runtime = new BrowserRuntime({});
  }, 60_000);

  afterAll(async () => {
    await runtime?.close(session).catch(() => undefined);
    // The engine's daemon outlives its MCP transport: close it (it never closes the attached Chrome).
    if (spec) await closeBrowserSession(AGENT_BROWSER, browserRuntimeEnv({ ...spec.env, AGENT_BROWSER_SESSION: session }), 10_000);
    await gate?.close();
    await sites?.close();
    await chrome?.close();
  }, 60_000);

  const call = (name: string, args: Record<string, unknown> = {}) => runMyChromeTool({
    session,
    params: { name, arguments: args },
    memory,
    run: (params) => runtime.agentRpc(session, spec, "tools/call", params),
    pageUrl: async () => `${sites.allowed}/`,
    confirm: async (summary) => { cards.push(summary); return answer; },
    notes: () => gate.takeNotes(session),
  }) as Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
  const text = (result: { content: Array<{ text: string }> }) => result.content.map((part) => part.text).join("\n");
  const ref = (result: { content: Array<{ text: string }> }, name: string) => {
    const match = new RegExp(`"${name}" \\[ref=(e\\d+)\\]`).exec(text(result).replace(/\\"/g, "\""));
    if (!match) throw new Error(`no ref for ${name} in ${text(result).slice(0, 800)}`);
    return `@${match[1]}`;
  };
  const body = async (key: string) => text(await call("agent_browser_get_text", { selector: "body" })) + key;

  it("drives the allowed site, cards a delete, a payment and a send, and refuses the rest", async () => {
    const opened = await call("agent_browser_open", { url: `${sites.allowed}/` });
    expect(opened.isError).toBeFalsy();
    const snap = await call("agent_browser_snapshot", { interactive: true });

    answer = "deny";
    const denied = await call("agent_browser_click", { selector: ref(snap, "Delete account") });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toMatch(/Not approved/);
    expect(cards.at(-1)).toMatch(/click button "Delete account" \(a delete\)/);
    const state = await call("agent_browser_get_url");
    expect(text(state)).toContain(sites.allowed);

    answer = "allow";
    const paid = await call("agent_browser_click", { selector: ref(snap, "Pay now") });
    expect(paid.isError).toBeFalsy();
    expect(cards.at(-1)).toMatch(/Pay now.*payment/);

    const cardsBefore = cards.length;
    const two = await call("agent_browser_click", { selector: ref(snap, "Two") });
    expect(two.isError).toBeFalsy();
    expect(cards.length).toBe(cardsBefore);

    await call("agent_browser_back");
    const again = await call("agent_browser_snapshot", { interactive: true });
    answer = "deny";
    await call("agent_browser_fill", { selector: ref(again, "Message"), text: "hello" });
    const pressed = await call("agent_browser_press", { key: "Enter" });
    expect(pressed.isError).toBe(true);
    expect(cards.at(-1)).toMatch(/press Enter/);
    const sent = await call("agent_browser_click", { selector: ref(again, "Send message") });
    expect(sent.isError).toBe(true);
    expect(cards.at(-1)).toMatch(/Send message.*send/);
    expect(await body("")).not.toMatch(/deleted|sent/);

    expect(text(await call("agent_browser_eval", { script: "document.cookie" }))).toMatch(/not available in My Chrome/);
    expect(text(await call("agent_browser_click", { selector: "#delete" }))).toMatch(/@eN refs/);
    const away = await call("agent_browser_open", { url: `${sites.other}/?via=tool` });
    expect(away.isError).toBe(true);
    expect(text(away)).toMatch(/blocked/);
    expect(sites.otherHits).not.toContain("/?via=tool");
  }, 120_000);

  it("stops at once when the person presses Stop", async () => {
    await gate.stop();
    const after = await call("agent_browser_get_url").catch((error: Error) => ({ content: [{ text: error.message }], isError: true }));
    expect(after.isError).toBe(true);
  }, 60_000);
});

describe.skipIf(!CHROME)("My Chrome and a bot with a shell on this computer", () => {
  it("decides the shell from where the bot works", () => {
    expect(hasShellOnThisComputer({ cloudOnly: false, teamComputer: false })).toBe(true);
    expect(hasShellOnThisComputer({ cloudOnly: true, teamComputer: false })).toBe(false);
    expect(hasShellOnThisComputer({ cloudOnly: false, teamComputer: true })).toBe(false);
  });

  it("gives the gate address only to a bot without a shell, on the test Chrome", async () => {
    const chrome = await launchTestChrome(CHROME!);
    const dataDir = mkdtempSync(join(tmpdir(), "sagax-mychrome-shell-"));
    const service = new MyChromeService({ dataDir, organization: false, locate: async () => chrome.wsUrl });
    try {
      await service.setEnabled(true);
      service.allowSite("http://localhost:9");
      await expect(service.urlFor("mychrome-a", { hasShell: true })).rejects.toThrow(MY_CHROME_SHELL_NOTE);
      const url = await service.urlFor("mychrome-b", { hasShell: false });
      expect(url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\//);
      const client = await CdpClient.connect(url);
      const { targetInfos } = await client.send("Target.getTargets");
      expect(targetInfos).toEqual([]);
      client.close();
      // The shell bot never reached the gate: no connection of its own.
      expect(service.status().gate.clients.map((entry) => entry.label)).not.toContain("mychrome-a");
    } finally {
      await service.close();
      await chrome.close();
      await removeTempDir(dataDir);
    }
  }, 60_000);
});
