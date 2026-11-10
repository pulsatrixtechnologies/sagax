// @vitest-environment happy-dom
// Fix the keys (#3321): a test the server refused with HTTP 401 or 403 says so
// and names the headers to check, never their values. Fix the keys opens the
// editor with only those values to type again; Save tests again.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", () => ({
  api: fixture.api,
  useStore: () => ({ state: { config: null, bots: [] }, dispatch: vi.fn() }),
}));
vi.mock("@/lib/app-links", () => ({ openExternalLink: vi.fn(async () => {}) }));
vi.mock("@/lib/mcp-servers", () => ({ updateMcpServers: vi.fn() }));

import { McpKeysRefused, McpServerEditor, probeFailureLabel, useMcpServers, type McpServerListing, type ProbeResult } from "./McpServersPanel";

const SECRET = "the-right-secret";
const gateway = { name: "orders", type: "http", url: "https://mcp.example.com/route", headerKeys: ["X-Client-Id", "X-Client-Secret"], enabled: true };
const bare = { name: "acme", type: "http", url: "https://mcp.acme.example/mcp", headerKeys: [], enabled: true };

let servers: McpServerListing[];
let tests: ProbeResult[];
let host: HTMLDivElement;
let root: Root;

function Page() {
  const mcp = useMcpServers();
  return createElement("div", null, ...(mcp.servers ?? []).map((server) => createElement("section", { key: server.name, "data-server": server.name },
    createElement("button", { type: "button", onClick: () => void mcp.test(server) }, `Test ${server.name}`),
    mcp.editing === server.name ? createElement(McpServerEditor, { mcp }) : null,
    createElement(McpKeysRefused, { mcp, server }),
  )));
}

const settle = () => act(async () => { for (let turn = 0; turn < 8; turn += 1) await Promise.resolve(); });
const button = (label: string) => [...host.querySelectorAll("button")].find((element) => element.textContent?.trim() === label);
const click = async (label: string) => { await act(async () => button(label)!.click()); await settle(); };
const calls = (method: string, path?: string) => fixture.api.mock.calls
  .filter(([url, init]) => (init?.method ?? "GET") === method && (!path || url === path))
  .map(([url, init]) => ({ url, body: init?.body ? JSON.parse(init.body as string) : undefined }));
async function type(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  setLocale("en");
  servers = [gateway as McpServerListing, bare as McpServerListing];
  tests = [];
  fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.split("?")[0] === "/api/mcp/servers") return { servers };
    if (path.endsWith("/test")) return tests.shift() ?? { ok: true, tools: [] };
    if (init?.method === "PUT") return { servers };
    throw new Error(`unexpected ${init?.method ?? "GET"} ${path}`);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Page)));
  await settle();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("Fix the keys", () => {
  it("names the refused headers, never their values, and asks for just those values, then tests again", async () => {
    tests.push({ ok: false, error: "The server didn't accept the keys (HTTP 403). Check the header values.", reason: "keys", status: 403 });
    await click("Test orders");
    expect(host.textContent).toContain("The server didn't accept the keys (HTTP 403). Check the values of X-Client-Id and X-Client-Secret.");

    await click("Fix the keys");
    const editor = host.querySelector("[data-mcp-editor]")!;
    expect(editor.textContent).toContain("Fix the keys for orders");
    expect([...editor.querySelectorAll("input")].map((input) => [input.getAttribute("aria-label"), input.type, input.value, input.placeholder])).toEqual([
      ["X-Client-Id", "password", "", "Paste the new value"],
      ["X-Client-Secret", "password", "", "Paste the new value"],
    ]);
    expect(editor.querySelector("textarea")).toBeNull();
    expect(host.querySelector("[data-mcp-keys-refused]")).toBeNull();

    tests.push({ ok: true, tools: [{ name: "lookup_order" }] });
    await type("input[aria-label='X-Client-Secret']", SECRET);
    await click("Save");
    expect(calls("PUT", "/api/mcp/servers/orders")[0]?.body).toEqual({
      type: "http", url: "https://mcp.example.com/route", headers: { "X-Client-Id": true, "X-Client-Secret": SECRET }, enabled: true,
    });
    expect(calls("POST", "/api/mcp/servers/orders/test")).toHaveLength(2);
    expect(host.querySelector("[data-mcp-editor]")).toBeNull();
    expect(host.querySelector("[data-mcp-keys-refused]")).toBeNull();
    expect(host.innerHTML).not.toContain(SECRET);
  });

  it("offers the header lines to a server that refused without a key, and nothing for another failure", async () => {
    tests.push({ ok: false, error: "The server didn't accept the keys (HTTP 401). Check the header values.", reason: "keys", status: 401 });
    await click("Test acme");
    expect(host.textContent).toContain("The server didn't let it in (HTTP 401). It probably needs a key: add it with Fix the keys.");
    await click("Fix the keys");
    expect(host.querySelector("[data-mcp-editor] textarea")).not.toBeNull();
    await click("Cancel");

    tests.push({ ok: false, error: "Could not reach this address. Check the URL and your network.", reason: "unreachable" });
    await click("Test acme");
    expect(button("Fix the keys")).toBeUndefined();
    expect(probeFailureLabel(bare as McpServerListing, { ok: false, error: "Could not reach this address. Check the URL and your network.", reason: "unreachable" }))
      .toBe("Could not reach this address. Check the URL and your network.");
  });

  it("says it in French with tu", () => {
    setLocale("fr");
    expect(probeFailureLabel(gateway as McpServerListing, { ok: false, reason: "keys", status: 403 }))
      .toBe("Le serveur n’a pas accepté les clés (HTTP 403). Vérifie les valeurs de X-Client-Id et X-Client-Secret.");
  });
});
