// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storedPersonLabel, resetPersonLabelsForTests } from "@/lib/person-labels";
import { setLocale } from "@/lib/i18n";

// Settings > General's one account card, clicked in a DOM: the label is
// edited in place under the name, and Sign out is the desktop's own leave.
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
  it("organization: one row, label under the name, Sign out at the right, managed with the server in its tooltip", async () => {
    vi.stubGlobal("ogb", undefined);
    await mount(LOCKED);
    const card = host.querySelector('[data-settings-card="general.account"]')!;
    expect(card).not.toBeNull();
    const text = card.textContent ?? "";
    expect(text.indexOf("Alex Martin")).toBeLessThan(text.indexOf("Add a label"));
    expect(text.indexOf("Add a label")).toBeLessThan(text.indexOf("owner@example.com"));
    expect(text).toContain("Edit in Perspicax");
    expect(card.querySelector("[data-account-managed]")?.getAttribute("title")).toBe("Connected to bot.example.test · Organization: Pulsatrix");
    // Sign out at the right of the row, no help paragraph
    expect(button("Sign out")?.closest("[data-account-action]")).not.toBeNull();
    expect(card.querySelector("[data-account-help]")).toBeNull();
    expect(button("Copy email")).toBeDefined();
  });

  it("edits the label in place and saves it", async () => {
    await mount(LOCKED);
    await act(async () => { button("Edit label")!.click(); });
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Edit label"]')!;
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "CTO");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); input.blur(); });
    await vi.waitFor(() => expect(storedPersonLabel("pr_owner")).toBe("CTO"));
    expect(calls).toContainEqual({ path: "/api/people/pr_owner/label", method: "PUT", body: { label: "CTO" } });
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

  it("personal server: editable profile and label, no Managed by your organization nor Edit in Perspicax", async () => {
    fixture.org = null;
    fixture.viewer = { principalId: "pr_me", operator: true };
    await mount(null);
    const text = host.textContent ?? "";
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Your name"]')?.value).toBe("Ada Local");
    expect(text).toContain("Add a label");
    expect(text).not.toContain("Managed by your organization");
    expect(text).not.toContain("Edit in Perspicax");
  });

  it("reads in French", async () => {
    setLocale("fr");
    await mount(LOCKED);
    const text = host.textContent ?? "";
    expect(text).toContain("Ajouter une étiquette");
    expect(text).toContain("Se déconnecter");
    expect(text).toContain("Géré par ton organisation");
    expect(text).toContain("Modifier dans Perspicax");
  });
});
