import { createElement, type EffectCallback, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as EffectCallback[], updating: false,
  store: { bots: [] as unknown[], instances: [] as unknown[], config: undefined as unknown, dispatch: (() => {}) as (action: unknown) => void, flushBotPatches: (async () => null) as (botId: string) => Promise<unknown> } }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? initial() : initial;
    return [fixture.values[index], (next: unknown) => {
      if (fixture.updating) throw new Error("A state updater called another state setter");
      fixture.updating = true;
      try { fixture.values[index] = typeof next === "function" ? next(fixture.values[index]) : next; }
      finally { fixture.updating = false; }
    }];
  },
  useRef: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = { current: initial };
    return fixture.values[index];
  },
  useEffect: (effect: EffectCallback) => { fixture.effects.push(effect); },
}));
vi.mock("@/state/store", async (original) => ({ ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ state: { bots: fixture.store.bots, instances: fixture.store.instances, config: fixture.store.config }, dispatch: fixture.store.dispatch, flushBotPatches: fixture.store.flushBotPatches }),
}));
import { OrganizationSettings } from "./OrganizationSettings";

function render() {
  fixture.index = 0; fixture.effects = [];
  let tree: ReactNode;
  function Capture() { tree = OrganizationSettings(); return tree; }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

beforeEach(() => {
  fixture.values = []; fixture.index = 0; fixture.effects = []; fixture.updating = false;
  // Member without editConfig: OrganizationBotRows stays empty in this SSR fixture
  // (the real solo owner keeps the advanced bot rules).
  fixture.store = {
    bots: [],
    instances: [],
    config: { viewer: { role: "member", capabilities: { editConfig: false, manageKeys: false, manageComputers: false, viewUsage: false, manageBackups: false, pairDevices: false } } },
    dispatch: vi.fn(),
    flushBotPatches: vi.fn(async () => null),
  };
  vi.stubGlobal("window", { ogb: { organization: { begin: vi.fn(), state: vi.fn(), onState: vi.fn(() => () => {}) } } });
  vi.stubGlobal("fetch", vi.fn());
  setLocale("en");
});
afterEach(() => { vi.unstubAllGlobals(); setLocale("en"); });

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, statusText: status === 404 ? "Not Found" : "Error", json: async () => body } as unknown as Response;
}

describe("Organization settings without the hosted Admin portal", () => {
  it("does not offer hosted portal sign-in, even when the desktop bridge is present", () => {
    const html = render().html;
    expect(html).not.toContain("Sign in with your organization");
    expect(html).not.toContain("https://admin.example.com");
    expect(html).not.toContain("Custom Admin portal");
    expect(html).not.toContain("openmausbot");
    const bridge = (window as unknown as { ogb: { organization: { begin: ReturnType<typeof vi.fn>; state: ReturnType<typeof vi.fn> } } }).ogb.organization;
    expect(bridge.begin).not.toHaveBeenCalled();
    expect(bridge.state).not.toHaveBeenCalled();
  });

  it("offers to join a Perspicax server once confirmed there is no organization", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(404, {}));
    render();
    for (const effect of fixture.effects) effect();
    await flush();
    const view = render();
    // #2080 L3: Connect to a server stays closed by default; Perspicax is the method
    expect(view.html).toContain("Connect to a server");
    expect(view.html).toContain('data-settings-card="organization.connect" data-open="false"');
    expect(view.html).toContain("Server");
    expect(view.html).not.toContain('data-settings-card="organization.joinPerspicax"');
    expect(view.html).not.toContain('data-settings-card="organization.connectServer"');
    expect(view.html).not.toContain("Create an organization");
    expect(view.html).not.toContain("Sign in with your organization");
  });
});

describe("Connect to a server: one card for the ways in", () => {
  it("offers Perspicax, a Sagax server and another computer by what this window can do", async () => {
    const { connectTargets } = await import("./ConnectServerWizard");
    // another computer needs a code from its Pair devices, hidden since 2026-10-14
    expect(connectTargets({ environments: true, remoteClient: true, remoteActive: false })).toEqual(["perspicax", "server"]);
    expect(connectTargets({ environments: true, remoteClient: true, remoteActive: false, computerPairing: true })).toEqual(["perspicax", "server", "computer"]);
    // a browser: Perspicax only (the copy of the bots is downloaded)
    expect(connectTargets({ environments: false, remoteClient: false, remoteActive: false })).toEqual(["perspicax"]);
    // already another computer's client: that card shows Disconnect instead
    expect(connectTargets({ environments: true, remoteClient: true, remoteActive: true })).toEqual(["server"]);
  });
});
