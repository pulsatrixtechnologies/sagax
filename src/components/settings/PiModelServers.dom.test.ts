// @vitest-environment happy-dom
// #2983: the person's model servers for pi. #4329 lot 1: each server is a
// provider of Settings > Providers; its page draws PiServerDetail (models,
// Test, Edit, Remove on the first level; address, provider name, context
// sizes in Advanced). Never loaded without the pi engine.
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InstanceInfo } from "@/state/store";
import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = vi.hoisted(() => ({
  instances: [] as InstanceInfo[],
  servers: [] as unknown[],
  calls: [] as Array<{ path: string; method: string; body?: unknown }>,
  refresh: vi.fn(),
}));

vi.mock("@/state/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/state/store")>();
  return {
    ...actual,
    api: vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      fixture.calls.push({ path, method, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      if (method === "GET") return { servers: fixture.servers };
      if (method === "POST" && path === "/api/me/pi-model-servers") {
        const body = JSON.parse(String(init!.body));
        return { server: { id: "sx-00000000aa", name: body.name, url: body.url, configured: false, models: [{ id: "llama3" }], provider: "px-own-sx-00000000aa" }, test: { ok: true, models: 1 } };
      }
      if (path.endsWith("/test")) return { server: fixture.servers[0], test: { ok: false, error: "The server did not answer in time." } };
      return { ok: true };
    }),
    useStore: () => ({ state: { instances: fixture.instances, bots: [], groups: [], config: {} }, refreshInstances: fixture.refresh }),
  };
});

const { usePiServers, PiServerDetail, PiServerForm } = await import("./PiModelServers");

let host: HTMLDivElement;
let root: Root;

/** The page's use of the module: the servers, one server's detail, the add form. */
function Harness() {
  const servers = usePiServers();
  const [adding, setAdding] = useState(false);
  return createElement("div", null,
    servers.servers === null ? null : createElement("span", { "data-count": String(servers.servers.length) }),
    ...(servers.servers ?? []).map((server) => createElement(PiServerDetail, {
      key: server.id, server, note: servers.notes[server.id], onChanged: servers.changed, onRemoved: () => servers.removed(server.id),
      advanced: (body: ReactNode) => createElement("div", { hidden: true, "data-advanced": "" }, body),
    })),
    adding ? createElement(PiServerForm, { onDone: (answer?: Parameters<typeof servers.changed>[0]) => { servers.changed(answer); setAdding(false); } })
      : createElement("button", { type: "button", "data-add": "", onClick: () => setAdding(true) }, "add"),
  );
}

async function render() {
  await act(async () => { root.render(createElement(Harness)); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  return host;
}
const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); }); };
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const pi = { instanceId: "pi", driverKind: "piAgent", displayName: "pi" } as InstanceInfo;
const saved = { id: "sx-0123456789", name: "oMLX", url: "http://127.0.0.1:8000/v1", configured: true, models: [{ id: "qwen", contextWindow: 32768 }], provider: "px-own-sx-0123456789" };

beforeEach(() => {
  setLocale("en");
  fixture.instances = [pi];
  fixture.servers = [];
  fixture.calls = [];
  fixture.refresh.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("the servers for pi", () => {
  it("are never loaded without the pi engine", async () => {
    fixture.instances = [{ instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude" } as InstanceInfo];
    const page = await render();
    expect(page.querySelector("[data-pi-server]")).toBeNull();
    expect(fixture.calls).toEqual([]);
  });

  it("draws a server's models on the first level; its address, provider id and context sizes only in Advanced", async () => {
    fixture.servers = [saved];
    const page = await render();
    const detail = page.querySelector<HTMLElement>('[data-pi-server="sx-0123456789"]')!;
    expect(detail.querySelector("[data-pi-server-models]")!.textContent).toContain("qwen");
    expect(detail.textContent).not.toContain("127.0.0.1");
    expect(detail.textContent).not.toContain("px-own");
    const advanced = page.querySelector<HTMLElement>("[data-pi-server-advanced]")!;
    expect(advanced.closest("[hidden]")).not.toBeNull();
    expect(advanced.textContent).toContain("http://127.0.0.1:8000/v1");
    expect(advanced.textContent).toContain("px-own-sx-0123456789");
  });

  it("adds a server, shows the test and refreshes the picker", async () => {
    const page = await render();
    expect(page.querySelector('[data-count="0"]')).not.toBeNull();
    await click(page.querySelector("[data-add]"));
    const inputs = page.querySelectorAll<HTMLInputElement>("[data-pi-server-form] input");
    await type(inputs[0]!, "Ollama");
    await type(inputs[1]!, "http://localhost:11434/v1");
    await click(page.querySelector('[data-pi-server-form] button[type="submit"]'));
    expect(fixture.calls.at(-1)).toEqual({ path: "/api/me/pi-model-servers", method: "POST", body: { name: "Ollama", url: "http://localhost:11434/v1" } });
    expect(page.querySelector('[data-pi-server="sx-00000000aa"] [data-pi-server-test="ok"]')).not.toBeNull();
    expect(fixture.refresh).toHaveBeenCalled();
  });

  it("tests again and removes after a second click", async () => {
    fixture.servers = [saved];
    const page = await render();
    await click(page.querySelector("[data-pi-server-test-run]"));
    expect(page.querySelector('[data-pi-server-test="error"]')!.textContent).toContain("did not answer in time");
    const remove = page.querySelector<HTMLElement>("[data-confirm-pill]")!;
    await click(remove);
    await click(page.querySelector('[data-confirm-pill="armed"]'));
    expect(fixture.calls.at(-1)).toMatchObject({ path: "/api/me/pi-model-servers/sx-0123456789", method: "DELETE" });
    expect(page.querySelector('[data-pi-server="sx-0123456789"]')).toBeNull();
  });
});
