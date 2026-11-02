// @vitest-environment happy-dom
// Settings split (2026-10-28, the owner): Account kept only the account;
// Security (security keys, approval rules, tool access) and Vault (the
// vault and the one-time card) are pages of their own, and Models and voice
// became Models and Voice. Nothing was removed: every moved setting is on its
// new page, the rules list is paged like the usage traces, old links and
// anchors open the new page, and the search finds each setting there.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, type AppSettingsSection, type InstanceInfo } from "@/state/store";
import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RULES = Array.from({ length: 23 }, (_, index) => ({
  id: `rule-${String(index + 1).padStart(2, "0")}`,
  botId: "bot-a",
  botName: "Scout",
  tool: "Bash",
  scope: { command: `echo ${index + 1}` },
  behavior: index % 3 === 0 ? "deny" : index % 3 === 1 ? "ask" : "allow",
  description: `Rule ${String(index + 1).padStart(2, "0")}`,
}));

const fixture = vi.hoisted(() => ({
  section: "account" as AppSettingsSection,
  dispatch: vi.fn(),
  config: undefined as Record<string, unknown> | undefined,
  rules: [] as unknown[],
  instances: [] as InstanceInfo[],
  refreshInstances: vi.fn(),
  refreshModels: vi.fn(),
}));

const answers = (path: string): unknown => {
  if (path === "/api/approval-rules") return { rules: fixture.rules };
  if (path === "/api/security-keys") return { keys: [], classes: [], rpId: "localhost" };
  if (path === "/api/me/tool-grants") return { grants: [], adminOnlyAreas: [] };
  if (path === "/api/me/voice-keys") return { elevenlabs: { configured: false }, fish: { configured: false }, xai: { configured: false } };
  if (path === "/api/me/credentials/list") return { items: [], onePassword: { available: false, reason: "absent" }, wallets: {} };
  if (path === "/api/instances/codex/auth/start" || path === "/api/instances/codex/auth/status?flowId=flow-a") return { auth: { phase: "waiting", flowId: "flow-a", userCode: "ABCD-EFGH", authorizationUrl: "https://auth.openai.com/codex/device", expiresAt: null } };
  throw new Error(`no answer for ${path}`);
};

vi.mock("@/state/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/state/store")>();
  const state = () => ({ appSettingsSection: fixture.section, appSettingsSubPage: null, instances: fixture.instances, bots: [{ id: "bot-a", name: "Scout", modelSelection: { instanceId: "codex", model: "gpt-5" } }], groups: [], config: fixture.config });
  return {
    ...actual,
    api: vi.fn(async (path: string) => answers(path)),
    useStore: () => ({ state: state(), dispatch: fixture.dispatch, refreshInstances: fixture.refreshInstances, refreshModels: fixture.refreshModels }),
    useStoreOptional: () => ({ state: state(), dispatch: fixture.dispatch }),
  };
});
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));

const { SettingsModal } = await import("./SettingsModal");
const { MyApprovalRules } = await import("./settings/MyApprovalRules");
const { clampPageOffset } = await import("./SettingsPager");
const { openSettings, currentSettingsSection, settingsSectionLabel } = await import("@/lib/settings-link");

let host: HTMLDivElement;
let root: Root;

async function render(element: Parameters<Root["render"]>[0]) {
  await act(async () => { root.render(element); });
  // the cards load their data in an effect: let the answers land
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
}

async function settings(section: AppSettingsSection): Promise<HTMLElement> {
  fixture.section = section;
  await render(createElement(SettingsModal));
  return host;
}

const rail = () => host.querySelector("nav")!;
const railLabels = (group: string) => [...rail().querySelectorAll(`[data-settings-nav-group="${group}"] button`)].map((node) => node.textContent?.trim());
const pane = () => host.querySelector<HTMLElement>("[data-settings-pane]")!;
const card = (id: string) => pane().querySelector(`[data-settings-card="${id}"]`);
const group = (id: string) => pane().querySelector(`[data-settings-group="${id}"]`);

beforeEach(() => {
  setLocale("en");
  fixture.section = "account";
  fixture.dispatch = vi.fn();
  fixture.config = { rooms: { turnTimeoutMinutes: 5 } };
  fixture.rules = RULES;
  fixture.instances = [];
  vi.mocked(api).mockClear();
  // happy-dom has no layout: every node counts as visible
  if (!("checkVisibility" in Element.prototype)) Object.defineProperty(Element.prototype, "checkVisibility", { configurable: true, value: () => true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setLocale("en");
  vi.useRealTimers();
});

describe("Settings split: navigation", () => {
  it("lists Account, Security, Vault, Appearance, Notifications under Personal, and Providers, Models, Voice under AI", async () => {
    await settings("account");
    expect(railLabels("you")).toEqual(["Account", "Security", "Vault", "Appearance", "Notifications"]);
    expect(railLabels("ai")).toEqual(["Providers", "Models", "Voice"]);
    expect(rail().textContent).not.toContain("Models and voice");
  });

  it("opens each new page from its entry", async () => {
    await settings("account");
    const button = [...rail().querySelectorAll("button")].find((node) => node.textContent?.trim() === "Vault")!;
    act(() => button.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "credentials" });
  });

  it("reads in French", async () => {
    setLocale("fr");
    await settings("account");
    expect(railLabels("you")).toEqual(["Compte", "Sécurité", "Coffre", "Apparence", "Notifications"]);
    expect(railLabels("ai")).toEqual(["Fournisseurs", "Modèles", "Voix"]);
  });
});

describe("Settings split: every moved setting at its new place", () => {
  it("keeps an in-progress sign-in and its polling when another provider is opened", async () => {
    fixture.instances = ["codex", "other"].map((id) => ({
      instanceId: id, driverKind: "codexAgent", displayName: id, access: "subscription",
      snapshot: { state: "available", authenticated: false }, models: { default: "", options: [] },
      authentication: { method: "device-code" }, install: { signInCommand: "codex login" },
    } as InstanceInfo));
    await settings("providers");
    const row = (id: string) => host.querySelector<HTMLElement>(`[data-provider-row="account:${id}"]`)!;
    const toggle = (id: string) => row(id).querySelector<HTMLButtonElement>(":scope > button")!;
    await act(async () => toggle("codex").click());
    vi.useFakeTimers();
    const start = [...row("codex").querySelectorAll("button")].find((button) => button.textContent?.includes("Connect ChatGPT"))!;
    await act(async () => start.click());
    const detail = row("codex").querySelector<HTMLElement>("[data-provider-detail]")!;
    expect(detail.textContent).toContain("ABCD-EFGH");
    await act(async () => toggle("other").click());
    expect(detail.hidden).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(api).toHaveBeenCalledWith("/api/instances/codex/auth/status?flowId=flow-a", expect.anything());
    await act(async () => toggle("codex").click());
    expect(row("codex").querySelector("[data-provider-detail]")).toBe(detail);
    expect(detail.hidden).toBe(false);
    expect(detail.textContent).toContain("ABCD-EFGH");
    expect(vi.mocked(api).mock.calls.filter(([path]) => path === "/api/instances/codex/auth/start")).toHaveLength(1);
  });

  it("Account keeps the account only", async () => {
    await settings("account");
    expect(group("account")).not.toBeNull();
    for (const id of ["security", "security.keys", "security.classes", "myApprovalRules", "myToolAccess", "credentials.items", "credentials.wallets"]) {
      expect(card(id) ?? group(id), id).toBeNull();
    }
  });

  it("Security holds the security keys, the approvals that need a key, the approval rules and My tool access", async () => {
    await settings("security");
    expect(pane().querySelector("h2")?.textContent).toBe("Security");
    expect(pane().querySelector("[data-security-page]")).not.toBeNull();
    expect(card("security")).not.toBeNull();
    for (const id of ["security.keys", "security.classes", "myApprovalRules", "myToolAccess"]) expect(group(id), id).not.toBeNull();
    expect(pane().textContent).toContain("Your approval rules");
    expect(pane().textContent).toContain("My tool access");
    expect(card("credentials.items")).toBeNull();
  });

  it("Vault holds Your vault (Import, Export, Add an item) and the One-time card", async () => {
    await settings("credentials");
    expect(pane().querySelector("h2")?.textContent).toBe("Vault");
    expect(card("credentials.items")).not.toBeNull();
    expect(pane().textContent).toContain("Your vault");
    for (const action of ["data-credentials-import", "data-credentials-export", "data-credentials-add"]) expect(pane().querySelector(`[${action}]`), action).not.toBeNull();
    expect(group("credentials.wallets")).not.toBeNull();
    expect(pane().textContent).toContain("One-time card");
    expect(card("credentials.onePassword")).not.toBeNull();
    expect(card("security")).toBeNull();
  });

  it("Voice holds the microphone, the voice engine and Live calls; Models keeps Auto and image generation, with one link to Providers", async () => {
    await settings("voice");
    expect(pane().querySelector("h2")?.textContent).toBe("Voice");
    for (const id of ["connections.audio", "connections.voice", "voice.advanced"]) expect(card(id), id).not.toBeNull();
    expect(pane().querySelector("[data-keys-section]")).toBeNull();
    await settings("engines");
    expect(pane().querySelector("h2")?.textContent).toBe("Models");
    expect(card("connections.image"), "connections.image").not.toBeNull();
    expect(pane().querySelector("[data-auto-model-explainer]")).not.toBeNull();
    // 2026-10-30 (#1812): the former Engines and Keys view left Models; one link opens Providers
    expect(pane().querySelector("[data-open-providers]")).not.toBeNull();
    for (const id of ["engines.legacy", "engines.list", "engines.keys"]) expect(card(id), id).toBeNull();
    await settings("providers");
    expect(pane().querySelector("h2")?.textContent).toBe("Providers");
    expect(card("providers.list"), "providers.list").not.toBeNull();
    for (const id of ["connections.audio", "connections.voice", "voice.advanced"]) expect(card(id), id).toBeNull();
  });

  // 2026-10-30 (#1812): every key, the voice keys included, is managed on Providers; Voice no
  // longer carries an "Add in Keys" row nor the member's own voice keys card.
  it("Voice no longer manages keys: no Add in Keys row, the voice keys anchor opens Providers", async () => {
    fixture.config = { rooms: { turnTimeoutMinutes: 5 }, tts: { configured: false, ready: false, voice: "", provider: "elevenlabs", keys: { elevenlabs: false, fish: false } }, live: { enabled: true, configured: false, voice: "", readTypedReplies: true, idleMinutes: 5 } };
    await settings("voice");
    expect(pane().querySelector('[data-add-in-keys]')).toBeNull();
    expect(card("connections.voiceKeys")).toBeNull();
    expect(currentSettingsSection("engines", "connections.voiceKeys")).toBe("providers");
  });

  it("an organization member's Voice page keeps the microphone, never the installation's voice engine", async () => {
    fixture.config = { rooms: { turnTimeoutMinutes: 5 }, viewer: { operator: false, role: "member" } };
    await settings("voice");
    expect(card("connections.audio")).not.toBeNull();
    // a member does not manage the installation: no voice engine, as before
    expect(card("connections.voice")).toBeNull();
  });
});

describe("Settings split: the approval rules are paged like the usage traces", () => {
  const rows = () => [...host.querySelectorAll("[data-my-rule-row]")].map((node) => node.textContent ?? "");
  const pager = () => host.querySelector<HTMLElement>("[data-settings-pager]")!;
  const next = () => pager().querySelector<HTMLButtonElement>("[data-settings-pager-next]")!;
  const prev = () => pager().querySelector<HTMLButtonElement>("[data-settings-pager-prev]")!;

  it("shows ten rules a page with the Usage pager, then the next pages", async () => {
    await render(createElement(MyApprovalRules));
    expect(host.querySelector("[data-my-rules]")?.getAttribute("data-my-rules")).toBe("23");
    expect(rows()).toHaveLength(10);
    expect(rows()[0]).toContain("Rule 01");
    expect(pager().textContent).toContain("1-10 of 23");
    expect(prev().disabled).toBe(true);
    await act(async () => next().click());
    expect(rows()[0]).toContain("Rule 11");
    expect(pager().textContent).toContain("11-20 of 23");
    await act(async () => next().click());
    expect(rows()).toHaveLength(3);
    expect(pager().textContent).toContain("21-23 of 23");
    expect(next().disabled).toBe(true);
    await act(async () => prev().click());
    expect(pager().textContent).toContain("11-20 of 23");
  });

  it("offers the same page sizes as the usage traces", async () => {
    await render(createElement(MyApprovalRules, { initialPageSize: 25 }));
    expect(rows()).toHaveLength(23);
    expect(pager().textContent).toContain("1-23 of 23");
    expect(pager().querySelector('[aria-label="Per page"]')).not.toBeNull();
  });

  it("draws no pager when there is no rule", async () => {
    fixture.rules = [];
    await render(createElement(MyApprovalRules));
    expect(host.querySelector("[data-settings-pager]")).toBeNull();
    expect(host.textContent).toContain("No rules yet");
  });

  it("never leaves an empty page after a removal", () => {
    expect(clampPageOffset(20, 20, 10)).toBe(10);
    expect(clampPageOffset(20, 23, 10)).toBe(20);
    expect(clampPageOffset(10, 0, 10)).toBe(0);
  });
});

describe("Settings split: old links and anchors open the new page", () => {
  const opened = (section: AppSettingsSection, cardId?: string) => {
    const sent: Array<{ section?: string }> = [];
    openSettings((action) => sent.push(action as { section?: string }), section, cardId);
    return sent[0]?.section;
  };

  it("sends Account's old security and vault anchors to Security and Vault", () => {
    expect(opened("account", "security")).toBe("security");
    expect(opened("account", "myApprovalRules")).toBe("security");
    expect(opened("account", "myToolAccess")).toBe("security");
    expect(opened("account", "credentials.items")).toBe("credentials");
    expect(opened("account", "credentials.wallets")).toBe("credentials");
    expect(opened("security")).toBe("security");
    expect(opened("credentials")).toBe("credentials");
  });

  it("sends Models and voice's voice anchors to Voice and the keys to Providers", () => {
    expect(opened("engines", "connections.voice")).toBe("voice");
    expect(opened("engines", "voice.advanced")).toBe("voice");
    expect(opened("connections", "connections.audio")).toBe("voice");
    expect(opened("engines", "voice.microphone")).toBe("voice");
    expect(opened("engines", "connections.voiceKeys")).toBe("providers");
    expect(opened("engines", "engines.keys")).toBe("providers");
    expect(opened("connections", "connections.image")).toBe("engines");
  });

  it("names the new page in a sentence's link", () => {
    expect(settingsSectionLabel(currentSettingsSection("engines", "voice.advanced"))).toBe("Voice");
    expect(settingsSectionLabel(currentSettingsSection("account", "credentials.items"))).toBe("Vault");
    expect(settingsSectionLabel(currentSettingsSection("account", "security"))).toBe("Security");
  });

  it("the store opens the page an old section names", async () => {
    const { currentSettingsSection: fromStore } = await import("@/lib/settings-sections");
    expect(fromStore("security")).toBe("security");
    expect(fromStore("credentials")).toBe("credentials");
    expect(fromStore("voice")).toBe("voice");
  });

});

describe("Settings split: the search finds each setting at its new place", () => {
  async function search(query: string): Promise<string[]> {
    await settings("account");
    const input = host.querySelector<HTMLInputElement>("[data-settings-search]")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, query);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return [...rail().querySelectorAll("[data-settings-nav-group] button[aria-current], [data-settings-nav-group] > div > button")].map((node) => node.textContent?.trim() ?? "");
  }

  it.each([
    ["yubikey", "Security"],
    ["always deny", "Security"],
    ["demander d'abord", "Security"],
    ["my tool access", "Security"],
    ["one-time card", "Vault"],
    ["1password", "Vault"],
    ["coffre", "Vault"],
    ["microphone", "Voice"],
    ["live calls", "Voice"],
    // 2026-10-30: keys are on Providers
    ["openrouter", "Providers"],
  ])("%s lands on %s only", async (query, page) => {
    const pages = await search(query);
    expect(pages).toEqual([page]);
  });
});
