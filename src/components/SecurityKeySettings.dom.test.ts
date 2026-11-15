// @vitest-environment happy-dom
// #2080: add creates then names; classes fold under a summary counter.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({
  state: {
    keys: [] as Array<{ id: string; name: string; createdAt: number; deviceType: "singleDevice" | "multiDevice"; rpId: string; lastUsedAt?: number }>,
    classes: ["destructive", "money"] as string[],
    rpId: "localhost",
    needsSignIn: undefined as boolean | undefined,
  },
  register: vi.fn(async (_name?: string, _signal?: AbortSignal) => {}),
  org: null as null | { name: string },
  againPath: null as string | null,
  api: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    if (path === "/api/security-keys" && (!init || !init.method || init.method === "GET")) return fixture.state;
    if (path === "/api/security-keys/register" || (path.startsWith("/api/security-keys/") && init?.method === "PATCH")) {
      return fixture.state;
    }
    if (path === "/api/security-keys/classes") {
      const body = JSON.parse(init?.body ?? "{}") as { classes: string[] };
      fixture.state = { ...fixture.state, classes: body.classes };
      return fixture.state;
    }
    return fixture.state;
  }),
}));

vi.mock("@/state/store", () => ({ api: (path: string, init?: { method?: string; body?: string }) => fixture.api(path, init) }));
vi.mock("@/lib/step-up-client", () => ({
  StepUpError: class extends Error { code = "cancelled"; },
  registerSecurityKey: (name: string, signal?: AbortSignal) => fixture.register(name, signal),
  securityKeyInBrowser: () => false,
  securityKeysUsable: () => true,
}));
vi.mock("@/lib/sign-in-again", () => ({ signInAgainPath: async () => fixture.againPath }));
vi.mock("@/lib/perspicax-org", () => ({ loadPerspicaxOrg: async () => fixture.org }));
vi.mock("@/lib/settings-return", () => ({ rememberSettingsReturn: () => {} }));

import { defaultSecurityKeyName, SecurityKeySettings } from "./SecurityKeySettings";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  fixture.state = { keys: [], classes: ["destructive", "money"], rpId: "localhost", needsSignIn: undefined };
  fixture.org = null;
  fixture.againPath = null;
  fixture.register.mockClear();
  fixture.api.mockClear();
  setLocale("en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.stubGlobal("isSecureContext", true);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setLocale("en");
});

describe("SecurityKeySettings (#2080)", () => {
  it("folds classes under a summary counter", async () => {
    fixture.state.keys = [{ id: "k1", name: "Yubi", createdAt: Date.now(), deviceType: "singleDevice", rpId: "localhost" }];
    await act(async () => { root.render(createElement(SecurityKeySettings)); });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain("Ask for a key for");
    expect(host.textContent).toContain("2 of 7");
    expect(host.querySelector("[data-security-classes]")).toBeNull();
    const choose = host.querySelector<HTMLButtonElement>('button[aria-label="Ask for a key for"]')!;
    await act(async () => { choose.click(); });
    expect(host.querySelector("[data-security-classes]")).toBeTruthy();
    expect(host.textContent).toContain("Deleting");
  });

  it("names a key after creating it", async () => {
    fixture.register.mockImplementation(async () => {
      fixture.state = {
        ...fixture.state,
        keys: [{ id: "new-key", name: defaultSecurityKeyName(), createdAt: Date.now(), deviceType: "singleDevice", rpId: "localhost" }],
      };
    });
    await act(async () => { root.render(createElement(SecurityKeySettings)); });
    await act(async () => { await Promise.resolve(); });
    const add = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Add a key"))!;
    await act(async () => { add.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(fixture.register).toHaveBeenCalled();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Key name"]');
    expect(input).toBeTruthy();
    await act(async () => {
      input!.value = "Blue key";
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // controlled input needs React change
    await act(async () => {
      const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      native.call(input!, "Blue key");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Save name"));
    expect(save).toBeTruthy();
  });

  // #4360: a server without an organization has no sign-in to make recent.
  describe("first key without a recent proof", () => {
    const render = async () => {
      await act(async () => { root.render(createElement(SecurityKeySettings)); });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    };
    it.each(["en", "fr"])("on a solo server, says to add it on the computer that runs the app, never to sign in again (%s)", async (locale) => {
      setLocale(locale);
      fixture.state.needsSignIn = true;
      await render();
      const row = host.querySelector('[data-row-id="security-keys-reauth"], #security-keys-reauth') ?? host;
      expect(row.textContent).toContain(locale === "fr" ? "Ajoute ta première clé sur ton ordinateur" : "Add your first key on your computer");
      expect(row.textContent).toContain(locale === "fr" ? "l’app de bureau Sagax" : "Sagax desktop app");
      expect(host.textContent).not.toMatch(/Sign in again|Reconnecte-toi|Pulsatrix/);
      expect([...host.querySelectorAll("button")].some((button) => /Sign in again|Me reconnecter/.test(button.textContent ?? ""))).toBe(false);
    });
    it("on a linked server, keeps Sign in again unchanged", async () => {
      fixture.org = { name: "Org" };
      fixture.againPath = "/auth/login?fresh=1";
      fixture.state.needsSignIn = true;
      await render();
      expect(host.textContent).toContain("Sign in again to add your first key");
      expect(host.textContent).not.toContain("on your computer");
      expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Sign in again")).toBe(true);
    });
    it("once the person is proven (no needsSignIn), offers Add a key", async () => {
      await render();
      expect(host.textContent).toContain("Add a security key or a passkey");
      expect(host.textContent).not.toContain("on your computer");
    });
  });
});
