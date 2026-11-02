import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserNetworkDebug,
  entryFromHar,
  parseNetworkDebugBody,
  redactedHar,
  redactHeaders,
  redactUrl,
  REDACTED,
  type NetworkDebugRunner,
} from "./browser-network-debug.ts";
import { HARNESS_OWNED_BROWSER_PARAMS, shapeBrowserToolResult, slimBrowserToolList } from "./browser-tool-shape.ts";

// Values that must never leave the debugger's redaction.
const COOKIE = "sessionid=COOKIE-SECRET-8c1f";
const BEARER = "Bearer AUTH-SECRET-77aa";
const API_KEY = "APIKEY-SECRET-0d2e";
const SET_COOKIE = "sid=SETCOOKIE-SECRET-41bb; HttpOnly";
const QUERY_TOKEN = "QUERY-SECRET-93fe";
const FRAGMENT_TOKEN = "FRAGMENT-SECRET-5a5a";
const BODY = "BODY-SECRET-c0de";
const SECRETS = [COOKIE, "COOKIE-SECRET-8c1f", "AUTH-SECRET-77aa", API_KEY, "SETCOOKIE-SECRET-41bb", QUERY_TOKEN, FRAGMENT_TOKEN, BODY, "user:pass"];

function harEntry(url = `https://user:pass@example.test/api/items?page=2&access_token=${QUERY_TOKEN}#id_token=${FRAGMENT_TOKEN}`) {
  return {
    _resourceType: "XHR",
    startedDateTime: "2026-10-16T11:10:53.015Z",
    time: 25.5,
    timings: { blocked: 0.1, dns: 0, connect: 0, ssl: 0, send: 0.2, wait: 25, receive: 0.2 },
    request: {
      method: "post", url, httpVersion: "HTTP/2",
      headers: [
        { name: "Cookie", value: COOKIE },
        { name: "Authorization", value: BEARER },
        { name: "X-Api-Key", value: API_KEY },
        { name: "X-CSRF-Token", value: "CSRF-SECRET-1" },
        { name: "Accept", value: "application/json" },
        { name: "Referer", value: `https://example.test/page?access_token=${QUERY_TOKEN}` },
        { name: "Link", value: `<https://example.test/next?sig=${FRAGMENT_TOKEN}>; rel="next"` },
      ],
      cookies: [{ name: "sessionid", value: "COOKIE-SECRET-8c1f" }],
      postData: { mimeType: "application/json", text: `{"password":"${BODY}"}` },
      bodySize: 42,
    },
    response: {
      status: 201, statusText: "Created", httpVersion: "HTTP/2",
      headers: [{ name: "Set-Cookie", value: SET_COOKIE }, { name: "Content-Type", value: "application/json" }, { name: "Location", value: `https://user:pass@example.test/cb?code=${QUERY_TOKEN}` }],
      cookies: [{ name: "sid", value: "SETCOOKIE-SECRET-41bb" }],
      content: { size: 128, mimeType: "application/json", text: `{"token":"${BODY}"}` },
      bodySize: 128,
    },
  };
}

function expectNoSecret(text: string) {
  for (const secret of SECRETS) expect(text, secret).not.toContain(secret);
}

describe("redaction", () => {
  it("removes userinfo, credential parameters and token fragments from URLs", () => {
    const url = redactUrl(`https://user:pass@example.test/cb?code=abc123&state=xyz&page=2&apiKey=${API_KEY}#access_token=${FRAGMENT_TOKEN}&x=1`);
    expectNoSecret(url);
    expect(url).not.toContain("abc123");
    expect(url).toContain("page=2");
    expect(url).toContain(encodeURIComponent(REDACTED));
    expect(redactUrl("javascript:alert(1)")).toBe("javascript:");
    expect(redactUrl("not a url")).toBe("");
  });

  it("redacts every credential header in both header shapes", () => {
    const list = redactHeaders([{ name: "Authorization", value: BEARER }, { name: "cookie", value: COOKIE }, { name: "Accept", value: "*/*" }]);
    expect(list).toEqual([{ name: "Authorization", value: REDACTED }, { name: "cookie", value: REDACTED }, { name: "Accept", value: "*/*" }]);
    const object = redactHeaders({ "Set-Cookie": SET_COOKIE, "x-amz-security-token": "T", "X-Session-Id": "S", "content-type": "text/html" });
    expect(Object.fromEntries(object.map((header) => [header.name, header.value]))).toEqual({
      "Set-Cookie": REDACTED, "x-amz-security-token": REDACTED, "X-Session-Id": REDACTED, "content-type": "text/html",
    });
  });

  it("keeps a HAR entry's summary and drops bodies and cookies", () => {
    const entry = entryFromHar(harEntry(), 1)!;
    expect(entry).toMatchObject({ method: "POST", status: 201, resourceType: "XHR", mimeType: "application/json", time: 25.5, requestBodySize: 42, responseBodySize: 128 });
    expect(entry.timings?.wait).toBe(25);
    expectNoSecret(JSON.stringify(entry));
    expect(JSON.stringify(entry)).not.toContain("postData");
    expect(entry.requestHeaders.find((header) => header.name === "Accept")?.value).toBe("application/json");
  });

  it("exports a HAR with no body, no cookie and no credential, headers only on request", () => {
    const entry = entryFromHar(harEntry(), 1)!;
    const withHeaders = JSON.stringify(redactedHar([entry], true, "1"));
    expectNoSecret(withHeaders);
    expect(withHeaders).toContain("application/json");
    const parsed = JSON.parse(withHeaders);
    expect(parsed.log.version).toBe("1.2");
    expect(parsed.log.entries[0].request.cookies).toEqual([]);
    expect(parsed.log.entries[0].response.content.text).toBeUndefined();
    const without = redactedHar([entry], false, "1") as { log: { entries: Array<{ request: { headers: unknown[] } }> } };
    expect(without.log.entries[0]!.request.headers).toEqual([]);
  });

  it("accepts only the four actions", () => {
    expect(parseNetworkDebugBody({ action: "refresh", includeHeaders: true })).toEqual({ action: "refresh", includeHeaders: true });
    for (const body of [null, {}, { action: "eval" }, { action: "start", includeHeaders: "yes" }]) expect(() => parseNetworkDebugBody(body)).toThrow();
  });
});

describe("BrowserNetworkDebug", () => {
  let root: string;
  let calls: string[][];
  let pending: unknown[];
  const spec = { command: "/bin/engine" };
  const target = { session: "bot-1", botId: "bot-1", owner: "local-owner" };
  const run: NetworkDebugRunner = async (_spec, _session, args) => {
    calls.push(args);
    if (args[0] === "network" && args[1] === "requests") {
      return { requests: [{ method: "GET", url: `https://example.test/?token=${QUERY_TOKEN}`, status: 200, headers: { Cookie: COOKIE }, responseHeaders: { "set-cookie": SET_COOKIE }, timestamp: 1_792_149_043_146 }] };
    }
    if (args[2] === "stop" && args[3]) {
      writeFileSync(args[3], JSON.stringify({ log: { entries: pending } }));
      pending = [];
      return { path: args[3] };
    }
    return { started: true };
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "netdebug-test-"));
    calls = []; pending = [];
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

  it("captures, refreshes, deletes each HAR file and logs nothing it captured", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    const debug = new BrowserNetworkDebug({ run, tempRoot: root });
    const started = await debug.start({ ...target, spec });
    expect(started.capturing).toBe(true);
    expect(started.entries).toHaveLength(1); // the backlog, without headers by default
    expect(started.entries[0]!.requestHeaders).toEqual([]);
    expect(calls).toEqual([["network", "requests"], ["network", "har", "start"]]);
    pending = [harEntry()];
    const refreshed = await debug.refresh({ ...target, includeHeaders: true });
    expect(refreshed.entries).toHaveLength(2);
    expect(refreshed.entries[1]!.requestHeaders.length).toBeGreaterThan(0);
    expectNoSecret(JSON.stringify(refreshed));
    expectNoSecret(JSON.stringify(debug.exportHar({ ...target, includeHeaders: true, version: "1" })));
    // the HAR file and its folder are gone
    const stopFile = calls.find((args) => args[2] === "stop")![3]!;
    expect(existsSync(stopFile)).toBe(false);
    expect(existsSync(dirname(stopFile))).toBe(false);
    expect(readdirSync(root)).toEqual([]);
    // and recording goes on
    expect(calls.at(-1)).toEqual(["network", "har", "start"]);
    await debug.stop(target);
    expect(debug.capturing(target.session)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map((part) => String(part))).join("\n");
    expectNoSecret(logged);
  });

  it("is one person's capture: another owner or bot is refused", async () => {
    const debug = new BrowserNetworkDebug({ run, tempRoot: root });
    await debug.start({ ...target, spec });
    await expect(debug.start({ ...target, owner: "someone-else", spec })).rejects.toThrow(/Another window/);
    await expect(debug.refresh({ ...target, owner: "someone-else" })).rejects.toThrow(/Another window/);
    expect(() => debug.exportHar({ ...target, botId: "bot-2", version: "1" })).toThrow();
    await debug.stop({ ...target, owner: "someone-else" });
    expect(debug.capturing(target.session)).toBe(true);
  });

  it("forgets everything when the browser closes, the person leaves, or the window goes idle", async () => {
    vi.useFakeTimers();
    try {
      const debug = new BrowserNetworkDebug({ run, tempRoot: root, idleMs: 1_000 });
      await debug.start({ ...target, spec });
      debug.clearSession(target.session);
      await expect(debug.refresh(target)).rejects.toThrow(/No capture/);
      await debug.start({ ...target, spec });
      debug.clearOwner(target.owner);
      expect(debug.capturing(target.session)).toBe(false);
      await debug.start({ ...target, spec });
      await vi.advanceTimersByTimeAsync(1_500);
      expect(debug.capturing(target.session)).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("drops a capture whose start failed and says so", async () => {
    const failing: NetworkDebugRunner = async (_spec, _session, args) => {
      if (args[1] === "har") throw new Error(`engine said ${COOKIE}`);
      return {};
    };
    const debug = new BrowserNetworkDebug({ run: failing, tempRoot: root });
    await expect(debug.start({ ...target, spec })).rejects.toThrow();
    expect(debug.capturing(target.session)).toBe(false);
  });
});

describe("never the bot's", () => {
  it("adds no browser tool, and a bot tool result carries nothing the debugger captured", () => {
    // The engine's network tools are not in the core set Sagax mounts; the
    // shaping keeps the listed tools as they are and adds none.
    const listed = slimBrowserToolList({ tools: [{ name: "agent_browser_click", inputSchema: { type: "object", properties: {} } }] }) as { tools: Array<{ name: string }> };
    expect(listed.tools.map((tool) => tool.name)).toEqual(["agent_browser_click"]);
    expect(HARNESS_OWNED_BROWSER_PARAMS.has("network")).toBe(false);
    const result = shapeBrowserToolResult({ content: [{ type: "text", text: "clicked" }] }) as { content: Array<{ text: string }> };
    expectNoSecret(JSON.stringify(result));
  });

  it("is not reachable through the engine MCP launch, the internal routes or the harness proxy", () => {
    const engine = readFileSync(join(import.meta.dirname, "browser-engine.ts"), "utf8");
    expect(engine).toContain('args: ["mcp", "--tools", "core", "--no-webmcp"]');
    const proxy = readFileSync(join(import.meta.dirname, "harness-mcp-proxy.ts"), "utf8");
    expect(proxy).not.toMatch(/network-debug|browser\/network|BrowserNetworkDebug/);
    const index = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");
    expect(index).not.toMatch(/\/api\/internal\/[^"'`]*network/);
    expect(index).toContain("ROUTES.push(createBrowserNetworkRoutes(");
    // the route lives in its module and is POST only
    const route = readFileSync(join(import.meta.dirname, "routes", "browser-network.ts"), "utf8");
    expect(route).toContain("/^\\/api\\/bots\\/([\\w-]+)\\/browser\\/network$/");
    expect(route).toContain('if (method !== "POST") return json(res, 405');
  });
});
