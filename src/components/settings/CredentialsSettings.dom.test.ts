// @vitest-environment happy-dom
// Vault rows (#2080): a closed item has one action. Reveal stays in the detail.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import type { VaultItemListing } from "../../../shared/credential-vault";

const login: VaultItemListing = {
  id: "item-1",
  kind: "login",
  name: "Example",
  username: "jc",
  domains: ["example.com"],
  hasPassword: true,
  hasTotp: false,
  hasApiKey: false,
  hasNotes: false,
  source: "local",
  grants: [],
  createdAt: 1,
  updatedAt: 1,
};

const fixture = vi.hoisted(() => ({
  load: vi.fn(),
  reveal: vi.fn(),
}));

vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({ state: { bots: [{ id: "bot-a", name: "Scout" }] }, dispatch: vi.fn() }),
}));

vi.mock("@/lib/credential-vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/credential-vault")>();
  return { ...actual, loadCredentials: fixture.load, revealCredential: fixture.reveal };
});

import { CredentialsSettings } from "./CredentialsSettings";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  setLocale("en");
  fixture.load.mockReset();
  fixture.reveal.mockReset();
  fixture.load.mockResolvedValue({
    items: [login],
    wallets: {},
    onePassword: { available: false, reason: "absent" },
  });
  fixture.reveal.mockResolvedValue({ value: "secret-value" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => { root.render(createElement(CredentialsSettings)); });
  for (let i = 0; i < 8; i += 1) {
    if (container.querySelector("[data-credentials-settings]")) return;
    await act(async () => { await Promise.resolve(); });
  }
}

describe("Vault item rows", () => {
  it("keeps one Manage action on a closed row and reveal in the detail", async () => {
    await render();
    const row = container.querySelector<HTMLElement>('[data-credential-item="item-1"]')!;
    expect(row).not.toBeNull();
    expect(row.querySelector("[data-credential-reveal]")).toBeNull();
    expect(row.querySelectorAll("button")).toHaveLength(1);
    expect(row.querySelector("button")!.textContent).toContain("Manage");
    expect(container.querySelector("[data-filter-chips]")).not.toBeNull();
    expect(container.querySelector("[data-credentials-add]")).not.toBeNull();
    expect(container.querySelector("[data-credentials-import]")).toBeNull();
    expect(container.querySelector("[data-credentials-export]")).toBeNull();
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-vault-menu]")!.click(); });
    expect(container.querySelector("[data-credentials-import]")).not.toBeNull();
    expect(container.querySelector("[data-credentials-export]")).not.toBeNull();
    await act(async () => { row.querySelector("button")!.click(); });
    const detail = row.querySelector("[data-credential-detail]")!;
    expect(detail.querySelector("[data-credential-reveal]")).not.toBeNull();
    expect(row.querySelector("[data-credential-reveal]")!.closest("[data-credential-detail]")).toBe(detail);
  });
});

describe("Vault that could not be opened (#3320)", () => {
  afterEach(() => { delete (window as unknown as { ogb?: unknown }).ogb; });

  it("explains Reset saved keys when the saved keys could not be read, never 'restart to try again'", async () => {
    (window as unknown as { ogb: unknown }).ogb = { credentialStore: { unreadable: async () => true, reset: vi.fn() } };
    fixture.load.mockResolvedValue({ items: [], wallets: {}, onePassword: { available: false, reason: "absent" }, unavailable: true });
    await render();
    await act(async () => { await Promise.resolve(); });
    const text = container.textContent ?? "";
    expect(text).toContain("Reset saved keys puts the unreadable files aside");
    expect(text).toContain("Vault items then start empty");
    expect(text).not.toContain("restart Sagax to try again");
    expect(container.querySelector("[data-saved-keys-reset] button")?.textContent).toBe("Reset saved keys");
  });

  it("keeps the restart advice when the saved keys were read", async () => {
    fixture.load.mockResolvedValue({ items: [], wallets: {}, onePassword: { available: false, reason: "absent" }, unavailable: true });
    await render();
    expect(container.textContent).toContain("restart Sagax to try again");
    expect(container.querySelector("[data-saved-keys-reset]")).toBeNull();
  });
});
