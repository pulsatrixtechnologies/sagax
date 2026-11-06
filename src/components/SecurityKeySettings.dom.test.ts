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
  },
  register: vi.fn(async (_name?: string, _signal?: AbortSignal) => {}),
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
vi.mock("@/lib/sign-in-again", () => ({ signInAgainPath: async () => null }));
vi.mock("@/lib/settings-return", () => ({ rememberSettingsReturn: () => {} }));

import { defaultSecurityKeyName, SecurityKeySettings } from "./SecurityKeySettings";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  fixture.state = { keys: [], classes: ["destructive", "money"], rpId: "localhost" };
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
});
