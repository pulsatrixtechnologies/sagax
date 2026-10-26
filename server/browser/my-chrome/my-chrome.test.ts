import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { removeTempDir } from "../../testing/cleanup.ts";
import { cdpMethodVerdict, maybeSameSite, sanitizeNetworkEvent, sessionEventAllowed } from "./cdp-policy.ts";
import { locateChrome, parseDevToolsActivePort } from "./locate.ts";
import { MyChromeMemory, myChromeAllowKey, myChromeToolRefusal, refsFromResult, runMyChromeTool, sensitiveAddress, sensitiveElement } from "./pilot.ts";
import { MyChromeService } from "./service.ts";
import { MY_CHROME_FILE, MyChromeSettingsStore, normalizeChromeAddress } from "./settings.ts";
import { myChromeSiteAllows, normalizeMyChromeSite } from "./sites.ts";

const dirs: string[] = [];
function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sagax-mychrome-unit-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => { for (const dir of dirs.splice(0)) await removeTempDir(dir); });

describe("My Chrome sites", () => {
  it("keeps one exact origin, https or http://localhost:port only", () => {
    expect(normalizeMyChromeSite("Example.com")).toBe("https://example.com");
    expect(normalizeMyChromeSite("https://mail.example.com/inbox?x=1")).toBe("https://mail.example.com");
    expect(normalizeMyChromeSite("example.com:8443")).toBe("https://example.com:8443");
    expect(normalizeMyChromeSite("http://localhost:3000/app")).toBe("http://localhost:3000");
    for (const bad of ["*.example.com", "http://example.com", "http://127.0.0.1:80", "https://user:pw@example.com", "file:///etc", "com", "10.0.0.1", "", 42]) {
      expect(normalizeMyChromeSite(bad), String(bad)).toBeNull();
    }
  });

  it("matches the page's origin only: no look-alike, subdomain, port or scheme", () => {
    const sites = ["https://example.com"];
    expect(myChromeSiteAllows(sites, "https://example.com/a/b?c")).toBe(true);
    for (const url of ["https://www.example.com/", "https://example.com.evil.test/", "http://example.com/", "https://example.com:444/", "https://u@example.com/", "javascript:alert(1)", "about:blank"]) {
      expect(myChromeSiteAllows(sites, url), url).toBe(false);
    }
  });
});

describe("My Chrome settings", () => {
  it("is off by default, saves 0600, and never reads a bad file as permission", () => {
    const dir = dataDir();
    const store = new MyChromeSettingsStore(dir);
    expect(store.get()).toMatchObject({ enabled: false, sites: [], stopped: false, allowOnOrganizationServer: false });
    store.allowSite("https://bank.example", 1);
    store.allowSite("bank.example", 2);
    expect(store.get().sites).toEqual([{ origin: "https://bank.example", addedAt: 1 }]);
    if (process.platform !== "win32") expect(statSync(join(dir, MY_CHROME_FILE)).mode & 0o777).toBe(0o600);
    expect(() => store.allowSite("*.bank.example")).toThrow(/one site/);
    store.revokeSite("https://bank.example/login");
    expect(store.get().sites).toEqual([]);
    writeFileSync(join(dir, MY_CHROME_FILE), "{not json");
    expect(new MyChromeSettingsStore(dir).get().enabled).toBe(false);
    writeFileSync(join(dir, MY_CHROME_FILE), JSON.stringify({ enabled: true, sites: [{ origin: "*.x.com" }, { origin: "https://ok.example" }], chromeAddress: "ws://evil.example:9222/x" }));
    expect(new MyChromeSettingsStore(dir).get()).toMatchObject({ enabled: true, sites: [{ origin: "https://ok.example" }], chromeAddress: "" });
  });

  it("reaches Chrome only on this computer's loopback", () => {
    expect(normalizeChromeAddress("9222")).toBe("9222");
    expect(normalizeChromeAddress("http://127.0.0.1:9222")).toBe("http://127.0.0.1:9222/");
    expect(normalizeChromeAddress("ws://localhost:9222/devtools/browser/abc")).toBe("ws://localhost:9222/devtools/browser/abc");
    for (const bad of ["http://192.168.1.2:9222", "ws://example.com/x", "https://127.0.0.1:9222", "99999", "ws://u:p@127.0.0.1:1/x"]) {
      expect(normalizeChromeAddress(bad), bad).toBeNull();
    }
  });

  it("an organization server never offers it unless its file says so by hand", async () => {
    const dir = dataDir();
    const service = new MyChromeService({ dataDir: dir, organization: true });
    expect(service.offered).toBe(false);
    await expect(service.setEnabled(true)).rejects.toThrow(/organization server/);
    writeFileSync(join(dir, MY_CHROME_FILE), JSON.stringify({ allowOnOrganizationServer: true }));
    expect(new MyChromeService({ dataDir: dir, organization: true }).offered).toBe(true);
  });

  it("allows nothing while off, stopped or with no site, and Stop holds across a restart", async () => {
    const dir = dataDir();
    const service = new MyChromeService({ dataDir: dir, organization: false });
    expect(service.unavailable()).toMatch(/off/);
    await service.setEnabled(true);
    expect(service.unavailable()).toMatch(/No site/);
    service.allowSite("https://shop.example");
    expect(service.unavailable()).toBeNull();
    expect(service.allows("https://shop.example/cart")).toBe(true);
    expect(service.allows("https://other.example/")).toBe(false);
    await service.stop();
    expect(service.allows("https://shop.example/cart")).toBe(false);
    expect(new MyChromeService({ dataDir: dir, organization: false }).unavailable()).toMatch(/stopped/);
    await expect(service.urlFor("mychrome-x")).rejects.toThrow(/stopped/);
    service.resume();
    expect(JSON.parse(readFileSync(join(dir, MY_CHROME_FILE), "utf8")).stopped).toBe(false);
    await service.close();
  });
});

describe("locating the person's Chrome", () => {
  it("reads only DevToolsActivePort's port and path", async () => {
    expect(parseDevToolsActivePort("9222\n/devtools/browser/abc-123\n")).toBe("ws://127.0.0.1:9222/devtools/browser/abc-123");
    expect(parseDevToolsActivePort("x\n/devtools/browser/a")).toBeNull();
    expect(parseDevToolsActivePort("9222\n/json")).toBeNull();
    const dir = dataDir();
    const file = join(dir, "DevToolsActivePort");
    writeFileSync(file, "4567\n/devtools/browser/xyz\n");
    await expect(locateChrome("", { files: [join(dir, "missing"), file] })).resolves.toBe("ws://127.0.0.1:4567/devtools/browser/xyz");
    await expect(locateChrome("", { files: [join(dir, "missing")] })).rejects.toThrow(/remote debugging is off/);
  });

  it("refuses an address Chrome gives that is not on this computer", async () => {
    const fake = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
    await expect(locateChrome("9222", { fetch: fake({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/a" }) })).resolves.toContain("127.0.0.1:9222");
    await expect(locateChrome("9222", { fetch: fake({ webSocketDebuggerUrl: "ws://10.0.0.5:9222/devtools/browser/a" }) })).rejects.toThrow(/not on this computer/);
    await expect(locateChrome("ws://example.com:9222/devtools/browser/a")).rejects.toThrow(/this computer/);
  });
});

describe("the DevTools policy", () => {
  it("lets through only what driving a tab needs", () => {
    for (const method of ["Browser.getVersion", "Target.getTargets", "Target.createTarget", "Target.attachToTarget"]) expect(cdpMethodVerdict(method, false).allow, method).toBe(true);
    for (const method of ["Browser.close", "Storage.getCookies", "Network.getAllCookies", "Target.createBrowserContext", "Target.attachToBrowserTarget", "Target.setAutoAttach", "Target.sendMessageToTarget", "Target.exposeDevToolsProtocol", "SystemInfo.getInfo", "Tracing.start", "x", "Browser.setDownloadBehavior"]) {
      expect(cdpMethodVerdict(method, false).allow, method).toBe(false);
    }
    for (const method of ["Page.navigate", "Runtime.evaluate", "DOM.getBoxModel", "Input.dispatchMouseEvent", "Accessibility.getFullAXTree", "Network.enable", "Target.setAutoAttach", "Page.captureScreenshot"]) {
      expect(cdpMethodVerdict(method, true).allow, method).toBe(true);
    }
    for (const method of ["Network.getCookies", "Network.getAllCookies", "Network.setCookie", "Network.getResponseBody", "Network.loadNetworkResource", "Storage.getCookies", "DOMStorage.getDOMStorageItems", "IndexedDB.requestData", "CacheStorage.requestEntries", "Fetch.enable", "Page.getCookies", "Page.setDownloadBehavior", "DOM.setFileInputFiles", "Autofill.trigger", "Target.createTarget", "Target.attachToTarget", "Browser.grantPermissions", "ServiceWorker.enable", "WebAuthn.enable", "Debugger.enable"]) {
      expect(cdpMethodVerdict(method, true).allow, method).toBe(false);
    }
  });

  it("drops every header, cookie and body from network events", () => {
    const event = sanitizeNetworkEvent("Network.requestWillBeSent", {
      requestId: "1", request: { url: "https://x.example/", method: "POST", headers: { Cookie: "a=b" }, postData: "secret" },
      redirectResponse: { status: 302, headers: { "Set-Cookie": "c=d" }, requestHeaders: { Cookie: "a=b" } }, associatedCookies: [{}],
    });
    expect(JSON.stringify(event)).not.toMatch(/a=b|c=d|secret|associatedCookies/);
    expect(sanitizeNetworkEvent("Network.requestWillBeSentExtraInfo", { headers: {} })).toBeNull();
    expect(sanitizeNetworkEvent("Network.responseReceivedExtraInfo", { headers: {} })).toBeNull();
    expect(sessionEventAllowed("Fetch.requestPaused")).toBe(false);
    expect(sessionEventAllowed("Page.loadEventFired")).toBe(true);
  });
});

describe("My Chrome tool calls", () => {
  const call = (name: string, args: Record<string, unknown> = {}) => ({ name, arguments: args });

  it("refuses scripts, cookies, state, CSS selectors and reading around the browser", () => {
    expect(myChromeToolRefusal(call("agent_browser_eval", { script: "1" }))).toMatch(/not available in My Chrome/);
    expect(myChromeToolRefusal(call("agent_browser_cookies_get"))).toMatch(/not available/);
    expect(myChromeToolRefusal(call("agent_browser_tools_profiles"))).toMatch(/not available/);
    expect(myChromeToolRefusal(call("agent_browser_click", { selector: "#buy" }))).toMatch(/@eN refs/);
    expect(myChromeToolRefusal(call("agent_browser_read", { url: "https://x.example" }))).toMatch(/open the address first/);
    expect(myChromeToolRefusal(call("agent_browser_screenshot", { path: "/tmp/x.png" }))).toMatch(/never to a file/);
    expect(myChromeToolRefusal(call("agent_browser_click", { selector: "@e3" }))).toBeNull();
    expect(myChromeToolRefusal(call("fill_credential", { handle: "cred_x", field: "password", selector: "@e2" }))).toBeNull();
  });

  it("names a payment, a send and a delete, and treats what it cannot name as one", () => {
    expect(sensitiveElement({ role: "button", name: "Supprimer le compte" })).toBe("delete");
    expect(sensitiveElement({ role: "menuitem", name: "Move to trash" })).toBe("delete");
    expect(sensitiveElement({ role: "button", name: "Payer maintenant" })).toBe("payment");
    expect(sensitiveElement({ role: "button", name: "Place order" })).toBe("payment");
    expect(sensitiveElement({ role: "button", name: "Envoyer" })).toBe("send");
    expect(sensitiveElement({ role: "button", name: "Publish" })).toBe("send");
    expect(sensitiveElement({ role: "button", name: "Enregistrer" })).toBe("send");
    expect(sensitiveElement({ role: "button", name: "" })).toBe("unclear");
    expect(sensitiveElement(undefined)).toBe("unclear");
    expect(sensitiveElement({ role: "link", name: "Next page" })).toBeNull();
    expect(sensitiveElement({ role: "link", name: "Delete this post" })).toBe("delete");
    expect(sensitiveElement({ role: "checkbox", name: "Remember me" })).toBeNull();
    expect(sensitiveElement({ role: "button", name: "Sign in" })).toBeNull();
    expect(sensitiveElement({ role: "button", name: "Show more" })).toBeNull();
    expect(sensitiveAddress("https://shop.example/checkout?step=2")).toBe("payment");
    expect(sensitiveAddress("https://x.example/items/4/delete")).toBe("delete");
    expect(sensitiveAddress("https://x.example/items")).toBeNull();
  });

  it("reads refs from the engine's JSON and from snapshot text", () => {
    const json = refsFromResult({ content: [{ type: "text", text: JSON.stringify({ data: { refs: { e1: { role: "button", name: "Delete" } } } }) }] });
    expect(json.get("e1")).toEqual({ role: "button", name: "Delete" });
    const text = refsFromResult({ content: [{ type: "text", text: "- generic\n  - button \"Pay \\\"now\\\"\" [ref=e7]\n  - link \"Home\" [ref=e8]" }] });
    expect(text.get("e7")).toEqual({ role: "button", name: "Pay \"now\"" });
    expect(text.get("e8")).toEqual({ role: "link", name: "Home" });
  });

  it("cards Enter except after typing in a search box, and text that ends a line", () => {
    const memory = new MyChromeMemory();
    memory.remember("s", call("agent_browser_snapshot"), { content: [{ type: "text", text: "- searchbox \"Search\" [ref=e1]\n- textbox \"Message\" [ref=e2]" }] });
    expect(memory.classify("s", call("agent_browser_press", { key: "Enter" }))?.kind).toBe("send");
    memory.remember("s", call("agent_browser_fill", { selector: "@e1", text: "shoes" }), { content: [] });
    expect(memory.classify("s", call("agent_browser_press", { key: "Enter" }))).toBeNull();
    memory.remember("s", call("agent_browser_fill", { selector: "@e2", text: "hi" }), { content: [] });
    expect(memory.classify("s", call("agent_browser_press", { key: "Enter" }))?.kind).toBe("send");
    expect(memory.classify("s", call("agent_browser_press", { key: "Tab" }))).toBeNull();
    expect(memory.classify("s", call("agent_browser_type", { selector: "@e2", text: "hi\n" }))?.kind).toBe("send");
    expect(memory.classify("s", call("agent_browser_click", { selector: "@e99" }))?.kind).toBe("unclear");
  });

  it("runs only what the person allowed, and adds what the gate blocked", async () => {
    const memory = new MyChromeMemory();
    memory.remember("s", call("agent_browser_snapshot"), { content: [{ type: "text", text: "- button \"Delete account\" [ref=e1]\n- link \"Two\" [ref=e2]" }] });
    const ran: unknown[] = [];
    const cards: string[] = [];
    const keys: Array<string | undefined> = [];
    let answer: "allow" | "deny" | "timeout" = "deny";
    const deps = (params: unknown) => ({
      session: "s", params, memory,
      run: async (p: unknown) => { ran.push(p); return { content: [{ type: "text", text: "ok" }] }; },
      pageUrl: async () => "https://x.example/account?id=1",
      confirm: async (summary: string, allowKey?: string) => { cards.push(summary); keys.push(allowKey); return answer; },
      notes: () => ["Sagax blocked https://evil.example"],
    });
    const denied = await runMyChromeTool(deps(call("agent_browser_click", { selector: "@e1" }))) as { isError?: boolean; content: Array<{ text: string }> };
    expect(denied.isError).toBe(true);
    expect(ran).toEqual([]);
    expect(cards).toEqual(["My Chrome: click button \"Delete account\" (a delete) on https://x.example"]);
    expect(keys).toEqual(["my_chrome:delete:https://x.example"]);
    answer = "timeout";
    expect((await runMyChromeTool(deps(call("agent_browser_click", { selector: "@e1" }))) as { isError?: boolean }).isError).toBe(true);
    answer = "allow";
    await runMyChromeTool(deps(call("agent_browser_click", { selector: "@e1" })));
    const plain = await runMyChromeTool(deps(call("agent_browser_click", { selector: "@e2" }))) as { content: Array<{ text: string }> };
    expect(ran).toHaveLength(2);
    expect(cards).toHaveLength(3);
    expect(plain.content.map((part) => part.text)).toEqual(["ok", "Sagax blocked https://evil.example"]);
    expect((await runMyChromeTool(deps(call("agent_browser_eval", { script: "1" }))) as { isError?: boolean }).isError).toBe(true);
    expect(ran).toHaveLength(2);
  });

  it("offers Always allow for one kind of action on one site, never for a doubt", () => {
    expect(myChromeAllowKey("payment", "https://shop.example/cart?x=1")).toBe("my_chrome:payment:https://shop.example");
    expect(myChromeAllowKey("send", "http://localhost:3000/a")).toBe("my_chrome:send:http://localhost:3000");
    expect(myChromeAllowKey("unclear", "https://shop.example/")).toBeUndefined();
    expect(myChromeAllowKey("delete", "")).toBeUndefined();
    expect(myChromeAllowKey("delete", "about:blank")).toBeUndefined();
    expect(myChromeAllowKey("delete", "file:///etc/hosts")).toBeUndefined();
  });

  it("takes refs only from a snapshot, so page text cannot rename a button", () => {
    const memory = new MyChromeMemory();
    memory.remember("s", call("agent_browser_snapshot"), { content: [{ type: "text", text: "- button \"Pay now\" [ref=e12]" }] });
    memory.remember("s", call("agent_browser_get_text"), { content: [{ type: "text", text: "- button \"Cancel\" [ref=e12]" }] });
    expect(memory.classify("s", call("agent_browser_click", { selector: "@e12" }))?.kind).toBe("payment");
    // A snapshot whose page text repeats a ref differently: that ref is carded.
    memory.remember("s", call("agent_browser_snapshot"), { content: [{ type: "text", text: "- button \"Pay now\" [ref=e12]\n- text: x\n- button \"Cancel\" [ref=e12]" }] });
    expect(memory.classify("s", call("agent_browser_click", { selector: "@e12" }))?.kind).toBe("unclear");
    // The JSON refs win over the text.
    memory.remember("s", call("agent_browser_snapshot"), { content: [{ type: "text", text: JSON.stringify({ data: { refs: { e12: { role: "button", name: "Pay now" } }, snapshot: "- button \"Cancel\" [ref=e12]" } }) }] });
    expect(memory.classify("s", call("agent_browser_click", { selector: "@e12" }))?.kind).toBe("payment");
  });

  it("cards Enter or Space with any modifier, even after a search box", () => {
    const memory = new MyChromeMemory();
    memory.remember("s", call("agent_browser_snapshot"), { content: [{ type: "text", text: "- searchbox \"Search\" [ref=e1]" }] });
    memory.remember("s", call("agent_browser_fill", { selector: "@e1", text: "x" }), {});
    expect(memory.classify("s", call("agent_browser_press", { key: "Enter" }))).toBeNull();
    for (const key of ["Control+Enter", "Meta+Enter", "Shift+Enter", "Alt+Return", "Control+Shift+Enter", "Shift+Space"]) {
      expect(memory.classify("s", call("agent_browser_press", { key }))?.kind).toBe("send");
    }
    expect(memory.classify("s", call("agent_browser_press", { key: "Control+a" }))).toBeNull();
  });

  it("closes what reaches frames of another origin on the same site", () => {
    expect(cdpMethodVerdict("Page.captureSnapshot", true).allow).toBe(false);
    expect(cdpMethodVerdict("Page.addScriptToEvaluateOnNewDocument", true, { source: "1", runImmediately: true }).allow).toBe(false);
    expect(cdpMethodVerdict("Page.addScriptToEvaluateOnNewDocument", true, { source: "1" }).allow).toBe(true);
    expect(maybeSameSite("https://accounts.example.com/x", "https://mail.example.com/")).toBe(true);
    expect(maybeSameSite("http://localhost:4000/", "http://localhost:3000/")).toBe(true);
    expect(maybeSameSite("https://a.example.co.uk/", "https://b.other.co.uk/")).toBe(true);
    expect(maybeSameSite("https://ads.tracker.net/", "https://mail.example.com/")).toBe(false);
    expect(maybeSameSite("https://x.example.com/", "about:blank")).toBe(true);
  });

  it("shows only the origin of a request to a site the person did not allow", () => {
    const allows = (url: string) => url.startsWith("https://shop.example/");
    const event = sanitizeNetworkEvent("Network.requestWillBeSent", {
      documentURL: "https://shop.example/cart",
      request: { url: "https://idp.example/cb?code=SECRET", headers: { a: "b" } },
      redirectResponse: { url: "https://idp.example/auth?state=1", headers: {} },
      initiator: { type: "script", url: "https://shop.example/app.js" },
    }, allows)!;
    expect((event.request as { url: string }).url).toBe("https://idp.example/");
    expect((event.redirectResponse as { url: string }).url).toBe("https://idp.example/");
    expect(event.documentURL).toBe("https://shop.example/cart");
    expect(event.initiator).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain("SECRET");
  });
});
