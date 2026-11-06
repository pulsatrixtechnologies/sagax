// @vitest-environment happy-dom
// Team canvas Computers panel (2026-11-06): the Boat "Connect Boat" card and
// the "New cloud computer" form are gone; the Unattended Remote Control setup
// stands in their place, lists enrolled hosts and asks the install code from
// POST /api/remote-hosts/code.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { BotEditorStore, type useStore } from "@/state/store";
import { CanvasComputers } from "./CanvasComputers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOST = `h_${"ab".repeat(16)}`;
const hosts = [{
  hostId: HOST, hostname: "Poste-Accueil", org: "Exemple inc.", scope: "full-control", state: "enrolled",
  enrolledAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-30T00:00:00.000Z",
  lastSeenAt: new Date().toISOString(), online: true, section: "Support",
}];

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let host: HTMLDivElement;
let root: Root;
const changes: unknown[][] = [];

beforeEach(() => {
  setLocale("en");
  calls = [];
  changes.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/api/team-computers")) return json({ configured: false, computers: [] });
    if (url.includes("/api/remote-hosts/code")) {
      return json({ code: "K7QM-NP42", enrollUrl: "https://example.com/enroll/K7QM-NP42", org: "Exemple inc.", scope: "full-control",
        expiresAt: "2026-11-06T20:00:00.000Z", installCommand: "sagax-remote-access install --unattended --code K7QM-NP42" });
    }
    if (url.includes("/api/remote-hosts/")) return json({ ok: true });
    if (url.includes("/api/remote-hosts")) return json({ available: true, hosts });
    return json({});
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const store = { state: { bots: [], groups: [], config: {} }, dispatch: () => {} } as unknown as ReturnType<typeof useStore>;

async function mount(createRequest = 0) {
  await act(async () => {
    const panel = createElement(CanvasComputers, {
      open: true, createRequest, drop: null,
      sections: [{ key: "Support", name: "Support" }, { key: "Ventes", name: "Ventes" }],
      onClose: () => {}, onDropHandled: () => {}, onChange: (list: unknown[]) => { changes.push(list); },
    });
    root.render(createElement(BotEditorStore, { value: store, children: panel }));
  });
  for (let i = 0; i < 3; i += 1) await act(async () => { await Promise.resolve(); });
}

const click = async (node: Element | null) => {
  expect(node).toBeTruthy();
  await act(async () => { (node as HTMLElement).click(); });
  for (let i = 0; i < 3; i += 1) await act(async () => { await Promise.resolve(); });
};

describe("CanvasComputers: Unattended Remote Control replaces Boat", () => {
  it("shows no Connect Boat card and no New cloud computer flow", async () => {
    await mount(1);
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Connect Boat");
    expect(text).not.toContain("Connect your Boat account");
    expect(text).not.toContain("New cloud computer");
    expect(text).not.toContain("Create cloud computer");
  });

  it("shows the Unattended Remote Control setup and lists enrolled hosts", async () => {
    await mount();
    expect(document.querySelector("[data-unattended-setup]")).toBeTruthy();
    expect(document.querySelector("[data-unattended-add]")).toBeTruthy();
    const card = document.querySelector(`[data-remote-host-id="${HOST}"]`);
    expect(card?.textContent).toContain("Poste-Accueil");
    expect(calls.some((call) => call.url.endsWith("/api/remote-hosts") && call.method === "GET")).toBe(true);
    const last = changes.at(-1) as Array<{ name: string; section: string | null }>;
    expect(last.some((computer) => computer.name === "Poste-Accueil" && computer.section === "Support")).toBe(true);
  });

  it("asks the install code from POST /api/remote-hosts/code and shows it", async () => {
    await mount();
    await click(document.querySelector("[data-unattended-add]"));
    await click(document.querySelector("[data-unattended-generate]"));
    const post = calls.find((call) => call.url.endsWith("/api/remote-hosts/code"));
    expect(post?.method).toBe("POST");
    expect(post?.body).toMatchObject({ scope: "full-control" });
    expect(document.querySelector("[data-unattended-code]")?.textContent).toContain("K7QM-NP42");
  });

  it("opens the setup form when the Add menu asks for a computer", async () => {
    await mount(1);
    expect(document.querySelector("[data-unattended-generate]")).toBeTruthy();
  });
});
