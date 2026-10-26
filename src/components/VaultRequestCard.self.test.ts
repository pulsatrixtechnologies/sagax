// @vitest-environment happy-dom
// "I'll sign in myself" on a vault card: the bot's browser is prepared
// first, and the card says plainly when it is not protected any more (Sagax
// restarted, 30 minutes passed, a newer card), never leaving the promise up.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const store = await importOriginal<typeof import("@/state/store")>();
  return { ...store, api: fixture.api, useStore: () => ({ state: { ...store.initialState, bots: [{ id: "bot-1", name: "Ada" }] }, dispatch: fixture.dispatch }) };
});

import { VaultRequestCard } from "./VaultRequestCard";
import type { Message } from "@/state/store";

const message = {
  id: "card-1", role: "bot", kind: "secret", at: 1, text: "Login for example.test",
  secret: { target: "vaultLogin", label: "Login for example.test", description: "", placeholder: "", helpUrl: "", requestKey: "k", vault: { principalId: "local", domain: "example.test" } },
} as Message;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  fixture.api.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

describe("signing in yourself from a vault card", () => {
  it("prepares the browser, then says it is not protected once the server no longer has it armed", async () => {
    let armed = true;
    fixture.api.mockImplementation(async (path: string) => {
      if (path === "/api/me/credentials/list") return { items: [], onePassword: { available: false } };
      if (path.endsWith("/self-start")) return { armed: true };
      if (path.endsWith("/self-status")) return { armed };
      throw new Error(`unexpected ${path}`);
    });
    act(() => root.render(createElement(VaultRequestCard, { botId: "bot-1", threadId: "t1", message })));
    await flush();
    act(() => { (container.querySelector("[data-vault-self]") as HTMLElement).click(); });
    await flush();
    await flush();
    expect(fixture.api.mock.calls.map(([path]) => path)).toContain("/api/bots/bot-1/vault-cards/card-1/self-start");
    expect(container.querySelector("[data-vault-self-panel]")?.textContent).toContain("cannot run scripts");
    expect(container.querySelector("[data-vault-self-unprotected]")).toBeNull();
    // The server lost the armed state (a restart of Sagax, 30 minutes, a newer card).
    armed = false;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5_100)); });
    expect(container.querySelector("[data-vault-self-unprotected]")?.textContent).toContain("Not protected any more");
    expect(container.querySelector("[data-vault-self-panel]")?.textContent).not.toContain("cannot run scripts");
    expect(container.querySelector("[data-vault-self-rearm]")).not.toBeNull();
  }, 15_000);

  it("shows nothing protected when the browser could not be prepared", async () => {
    fixture.api.mockImplementation(async (path: string) => {
      if (path === "/api/me/credentials/list") return { items: [], onePassword: { available: false } };
      if (path.endsWith("/self-start")) throw new Error("A bot ran a script in this browser");
      throw new Error(`unexpected ${path}`);
    });
    act(() => root.render(createElement(VaultRequestCard, { botId: "bot-1", threadId: "t1", message })));
    await flush();
    act(() => { (container.querySelector("[data-vault-self]") as HTMLElement).click(); });
    await flush();
    expect(container.querySelector("[data-vault-self-panel]")).toBeNull();
    expect(container.textContent).toContain("A bot ran a script");
  });
});
