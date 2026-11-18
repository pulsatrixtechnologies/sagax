// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetPersonLabelsForTests } from "@/lib/person-labels";
import { setLocale } from "@/lib/i18n";

// Settings > General's one account card, clicked in a DOM: the reference's
// two rows (identity, Team), and Sign out is the desktop's own leave.
const fixture = vi.hoisted(() => ({
  viewer: {} as Record<string, unknown>,
  org: null as null | { org: { name: string } },
  dispatch: vi.fn(),
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: { config: { viewer: fixture.viewer, profile: { name: "Ada Local", email: "ada@example.com" } } }, dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/perspicax-org")>(),
  usePerspicaxOrg: () => fixture.org,
}));
vi.mock("../DesktopWorkspaceSwitcher", () => ({ useDesktopWorkspace: () => ({ available: false, current: null, open: false, error: "", openMenu: () => {} }) }));

const { AccountCard } = await import("./AccountCard");

const LOCKED = { active: true as const, id: "w1", name: "Pulsatrix", origin: "https://bot.example.test" };
let host: HTMLDivElement;
let root: Root;
let calls: Array<{ path: string; method?: string; body: unknown }>;

async function mount(lockedServer: typeof LOCKED | null) {
  await act(async () => { root.render(createElement(AccountCard, { lockedServer })); });
}
const button = (text: string) => [...host.querySelectorAll("button")].find((node) => node.textContent?.includes(text) || node.getAttribute("aria-label") === text);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  setLocale("en");
  resetPersonLabelsForTests();
  fixture.dispatch.mockReset();
  fixture.org = { org: { name: "Pulsatrix" } };
  fixture.viewer = { principalId: "pr_owner", name: "Alex Martin", email: "owner@example.com", profileManagedBy: "perspicax", profileManageUrl: "https://px.example.test/console/me" };
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method: init?.method, body });
    if (path.endsWith("/label")) return new Response(JSON.stringify({ principalId: "pr_owner", label: body?.label ?? null }), { status: 200 });
    return new Response(JSON.stringify({ labels: [] }), { status: 200 });
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  resetPersonLabelsForTests();
});

describe("Settings > General account card", () => {
  it("organization: one identity row, the person's name holds the server and the managed note in its tooltip, no Team row", async () => {
    vi.stubGlobal("ogb", undefined);
    await mount(LOCKED);
    const card = host.querySelector('[data-settings-card="general.account"]')!;
    expect(card).not.toBeNull();
    // the identity row is the reference's two lines: name, then email
    const identity = card.querySelector('[data-testid="account-identity"]')!.textContent ?? "";
    expect(identity.indexOf("Alex Martin")).toBeLessThan(identity.indexOf("owner@example.com"));
    expect(identity).not.toContain("Add a label");
    expect(card.querySelector("[data-my-label]")).toBeNull();
    // one row: no Team row any more (the owner 2026-11-17)
    expect([...card.children].filter((node) => node.textContent).map((node) => node.getAttribute("data-testid"))).toEqual(["account-identity"]);
    expect(card.querySelector("[data-account-team]")).toBeNull();
    expect(card.textContent).not.toContain("Team");
    expect(card.textContent).not.toContain("Pulsatrix");
    const name = card.querySelector<HTMLButtonElement>("[data-account-server]")!;
    expect(name.textContent).toBe("Alex Martin");
    expect(name.getAttribute("title")).toBe("Connected to bot.example.test · Managed by your organization · Edit in Perspicax");
    expect(card.querySelector("[data-server-connected]")).toBeNull();
    expect(card.textContent).not.toContain("Server");
    expect(card.textContent).not.toContain("Managed by your organization");
    // Sign out at the right of the row, no help paragraph
    expect(button("Sign out")?.closest("[data-account-action]")).not.toBeNull();
    expect(card.querySelector("[data-account-help]")).toBeNull();
    expect(button("Copy email")).toBeDefined();
  });

  it("the person's name opens the Perspicax profile", async () => {
    const open = vi.fn();
    (window as unknown as { ogb: unknown }).ogb = { openExternal: open };
    await mount(LOCKED);
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-account-server]")!.click(); });
    expect(open).toHaveBeenCalledWith("https://px.example.test/console/me");
    delete (window as unknown as { ogb?: unknown }).ogb;
  });

  it("Sign out calls the desktop's leave, and says so when it fails", async () => {
    const leave = vi.fn(async () => { throw new Error("no"); });
    (window as unknown as { ogb: unknown }).ogb = { serverMode: { state: vi.fn(), leave } };
    await mount(LOCKED);
    await act(async () => { button("Sign out")!.click(); });
    expect(leave).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not sign out");
    delete (window as unknown as { ogb?: unknown }).ogb;
  });

  it("solo install: one row, editable profile, no Team nor Server row, no Managed by your organization nor Edit in Perspicax", async () => {
    fixture.org = null;
    fixture.viewer = { principalId: "pr_me", operator: true };
    await mount(null);
    const text = host.textContent ?? "";
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Your name"]')?.value).toBe("Ada Local");
    expect(text).not.toContain("Add a label");
    expect(host.querySelector("[data-account-team]")).toBeNull();
    expect(host.querySelector("[data-server-connected]")).toBeNull();
    expect(text).not.toContain("Managed by your organization");
    expect(text).not.toContain("Edit in Perspicax");
  });

  it("reads in French", async () => {
    setLocale("fr");
    await mount(LOCKED);
    const text = host.textContent ?? "";
    expect(text).not.toContain("Équipe");
    expect(text).not.toContain("Serveur");
    expect(text).toContain("Se déconnecter");
    expect(host.querySelector("[data-account-server]")?.getAttribute("title")).toBe("Connecté à bot.example.test · Géré par ton organisation · Modifier dans Perspicax");
  });
});
