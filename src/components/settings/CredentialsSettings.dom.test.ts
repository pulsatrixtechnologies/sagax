// @vitest-environment happy-dom
// Vault rows (#2080): a closed item has one action. Reveal stays in the
// item's window. #4094: the page, New item and Import follow the reference.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale, t } from "@/lib/i18n";

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
  it("keeps one Manage action on a row; reveal lives in the item's window", async () => {
    await render();
    const row = container.querySelector<HTMLElement>('[data-credential-item="item-1"]')!;
    expect(row).not.toBeNull();
    expect(row.querySelector("[data-credential-reveal]")).toBeNull();
    expect(row.querySelectorAll("button")).toHaveLength(1);
    expect(row.querySelector("button")!.textContent).toContain("Manage");
    await act(async () => { row.querySelector<HTMLButtonElement>("[data-vault-manage]")!.click(); });
    const dialog = document.querySelector<HTMLElement>('[data-vault-dialog][data-credential-manage="item-1"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.querySelector("[data-credential-detail] [data-credential-reveal]")).not.toBeNull();
    expect(dialog.querySelector("[data-vault-edit]")).not.toBeNull();
    await act(async () => { dialog.querySelector<HTMLButtonElement>("[data-vault-edit]")!.click(); });
    expect(document.querySelector('[data-vault-dialog][data-credential-dialog="edit"]')).not.toBeNull();
  });
});

// #4094: the page the reference's way. One New item menu (the kinds, then
// Import and Export), tabs with counts and the search on one row, one list,
// the grey sentence under it; New item and Import open centered windows.
describe("Vault page like the reference (#4094)", () => {
  const openMenu = async () => {
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-vault-new] button")!.click(); });
  };

  it("draws one New item menu, every tab with its count, the search and the sentence under the list", async () => {
    await render();
    expect(container.querySelector("[data-vault-menu]")).toBeNull();
    expect(container.querySelector("[data-credentials-add]")).toBeNull();
    expect(container.querySelectorAll("[data-vault-new]")).toHaveLength(1);
    const toolbar = container.querySelector<HTMLElement>("[data-vault-toolbar]")!;
    const tabs = [...toolbar.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["All1", "Logins1", "Payments0", "Contacts0"]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(toolbar.querySelector("[data-vault-search]")).not.toBeNull();
    // said once: the encryption is the page's intro, never repeated under the list
    const footer = container.querySelector("[data-vault-footer]")!.textContent!;
    expect(footer).toContain("Bots never see");
    expect(footer).not.toContain("Encrypted");
    await openMenu();
    const items = [...document.querySelectorAll<HTMLElement>("[data-bot-profile-add-item]")].map((item) => item.dataset.botProfileAddItem);
    expect(items).toEqual(["login", "apiKey", "note", "card", "address", "contact", "import", "export"]);
  });

  it("opens New login as a centered window with stacked fields, Save off until a website or a name is typed", async () => {
    await render();
    await openMenu();
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-bot-profile-add-item="login"]')!.click(); });
    const dialog = document.querySelector<HTMLElement>('[data-vault-dialog][data-credential-dialog="new"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector("h2")!.textContent).toBe("New login");
    expect(dialog.querySelector("[data-editor-stack]")).not.toBeNull();
    expect(container.querySelector("[data-credential-form]")).toBeNull();
    const save = dialog.querySelector<HTMLButtonElement>("[data-credential-save]")!;
    expect(save.textContent).toBe("Save login");
    expect(save.disabled).toBe(true);
    const site = dialog.querySelector<HTMLInputElement>('input[aria-label="Website"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(site, "example.com");
      site.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(save.disabled).toBe(false);
    await act(async () => { dialog.querySelector<HTMLButtonElement>("[data-credential-add-site]")!.click(); });
    expect(dialog.querySelectorAll("[data-credential-sites] input")).toHaveLength(2);
  });

  it("says Optional once: in the label, never again in a field's placeholder", async () => {
    await render();
    await openMenu();
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-bot-profile-add-item="login"]')!.click(); });
    const dialog = document.querySelector<HTMLElement>('[data-vault-dialog][data-credential-dialog="new"]')!;
    const placeholders = [...dialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].map((field) => field.placeholder);
    expect(placeholders.filter((text) => /optional/i.test(text))).toEqual([]);
    expect(dialog.querySelector<HTMLInputElement>('input[aria-label="One-time code seed"]')!.placeholder).toBe("Seed or otpauth:// link");
    // what the note's old placeholder said stays, once, as its grey line
    expect(dialog.textContent).toContain("Never shown to bots.");
  });

  it("leaves the Payments tab without the sentence its own intro already says", async () => {
    await render();
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-filter-chip="payments"]')!.click(); });
    expect(container.querySelector("[data-vault-footer]")).toBeNull();
  });

  it("says how the vault is encrypted once, whole, in the page's intro", () => {
    // the server-key half matters on an organization server
    expect(t("settings.intro.credentials")).toContain("with the system keychain, or with the server's key");
    setLocale("fr");
    expect(t("settings.intro.credentials")).toContain("avec le trousseau du système, ou avec la clé du serveur");
    setLocale("en");
  });

  it("shows a failure of the Manage window once, in the window, never also as the page's notice", async () => {
    fixture.reveal.mockRejectedValue(new Error("The vault refused the reveal."));
    await render();
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-credential-item="item-1"] [data-vault-manage]')!.click(); });
    const dialog = document.querySelector<HTMLElement>('[data-vault-dialog][data-credential-manage="item-1"]')!;
    await act(async () => { dialog.querySelector<HTMLButtonElement>("[data-credential-reveal]")!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("refused the reveal");
    const page = container.querySelector<HTMLElement>("[data-credentials-settings]")!;
    expect(page.textContent).not.toContain("refused the reveal");
  });

  it("scrolls the tab row so the chosen tab reads whole on a narrow screen", async () => {
    await render();
    const row = container.querySelector<HTMLElement>('[data-vault-toolbar] [role="tablist"]')!;
    const layout = (element: HTMLElement, values: Record<string, number>) => {
      for (const [name, value] of Object.entries(values)) Object.defineProperty(element, name, { configurable: true, writable: true, value });
    };
    // a 200 px row holding 360 px of tabs, as the French tabs on a phone
    layout(row, { offsetLeft: 0, clientWidth: 200, scrollLeft: 0 });
    const boxes: Record<string, [number, number]> = { all: [0, 50], logins: [54, 100], payments: [158, 96], contacts: [258, 102] };
    for (const [id, [left, width]] of Object.entries(boxes)) layout(row.querySelector<HTMLElement>(`[data-filter-chip="${id}"]`)!, { offsetLeft: left, offsetWidth: width });
    await act(async () => { row.querySelector<HTMLButtonElement>('[data-filter-chip="contacts"]')!.click(); });
    expect(row.scrollLeft).toBe(160);
    await act(async () => { row.querySelector<HTMLButtonElement>('[data-filter-chip="all"]')!.click(); });
    expect(row.scrollLeft).toBe(0);
  });

  it("opens Import as a centered window, never a panel in the page", async () => {
    await render();
    await openMenu();
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-bot-profile-add-item="import"]')!.click(); });
    expect(document.querySelector("[data-vault-dialog][data-credential-import]")).not.toBeNull();
    expect(container.querySelector("[data-credential-import]")).toBeNull();
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
