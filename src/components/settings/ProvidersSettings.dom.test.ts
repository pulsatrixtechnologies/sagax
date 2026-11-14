// @vitest-environment happy-dom
// Settings > Providers after #4329 lot 1 (the owner 2026-11-14: "You select a
// provider, you log in, done"): one short list, one row per provider, a
// second account as a second line with its own button, no group that
// unfolds; a row opens the provider's page (Accounts, Runs with, Models,
// Advanced). No address and no tool name outside Advanced. Add a provider is
// one list then one step. Still: no organization band, no row the
// organization pays for, Other services and Providers' own Advanced.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InstanceInfo } from "@/state/store";
import type { MyEngine } from "@/lib/perspicax-org";
import { setLocale } from "@/lib/i18n";
import { XAI_GROUP_LABEL } from "../../../shared/model-provider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = vi.hoisted(() => ({
  org: null as null | { org: { name: string; identity: { kind: "perspicax"; issuer: string } } },
  mine: null as null | MyEngine[],
  config: {} as Record<string, unknown>,
  instances: [] as InstanceInfo[],
  dispatch: vi.fn(),
  local: { expose: false, share: false, connected: false, endpoints: [], published: [], probes: [] } as Record<string, unknown>,
  piServers: [] as unknown[],
  keys: [] as { provider: string; last4: string | null }[],
}));

const answers = (path: string): unknown => {
  if (path === "/api/me/providers") return { keys: fixture.keys, servers: [] };
  if (path === "/api/me/local-models") return fixture.local;
  if (path === "/api/me/pi-model-servers") return { servers: fixture.piServers };
  if (path.startsWith("/api/me/pi-model-servers/")) return {};
  if (path.startsWith("/api/me/providers/")) return { keys: [], servers: [] };
  throw new Error(`no answer for ${path}`);
};

vi.mock("@/state/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/state/store")>();
  const state = () => ({ instances: fixture.instances, bots: [], groups: [], config: fixture.config });
  return {
    ...actual,
    api: vi.fn(async (path: string) => answers(path)),
    useStore: () => ({ state: state(), dispatch: fixture.dispatch, refreshInstances: vi.fn(), refreshModels: vi.fn() }),
    useStoreOptional: () => ({ state: state(), dispatch: fixture.dispatch }),
  };
});
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/perspicax-org")>(),
  usePerspicaxOrg: () => fixture.org,
  useMyEngines: () => fixture.mine,
}));
vi.mock("@/lib/desktop-local-models", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/desktop-local-models")>(),
  loadLocalModels: vi.fn(async () => fixture.local),
}));
vi.mock("../DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("../HarnessConnectorsSection", () => ({ HarnessConnectorsSection: () => createElement("div", { "data-harness-connectors": "" }) }));

const { ProvidersSettings, addChoices } = await import("./ProvidersSettings");
const { api: apiMock } = await import("@/state/store");
const apiCalls = (method: string) => vi.mocked(apiMock).mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === method).map(([path, init]) => [path, (init as RequestInit).body ?? null]);
const { ProviderPage } = await import("./ProviderPage");
const { resetSettingsCards, requestSettingsCard } = await import("../SettingsPrimitives");

let host: HTMLDivElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
}
async function render(element: Parameters<Root["render"]>[0] = createElement(ProvidersSettings)) {
  await act(async () => { root.render(element); });
  await settle();
  return host;
}
const page = (providerId: string) => render(createElement(ProviderPage, { providerId }));
const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); }); await settle(); };
/** What the person reads without opening anything: hidden blocks left out. */
function visibleText(node: Element): string {
  if ((node as HTMLElement).hidden) return "";
  return [...node.childNodes].map((child) => child.nodeType === Node.TEXT_NODE ? child.textContent ?? "" : child instanceof Element ? visibleText(child) : "").join(" ");
}

const instance = (instanceId: string, driverKind: string, displayName: string, over: Partial<InstanceInfo> = {}): InstanceInfo => ({
  instanceId, driverKind, displayName, access: "api", cliDefault: instanceId,
  snapshot: { state: "available", authenticated: true },
  models: { default: `${instanceId}-1`, options: [{ id: `${instanceId}-1`, label: `${displayName} One` }, { id: `${instanceId}-2`, label: `${displayName} Two` }] },
  ...over,
} as InstanceInfo);
const mine = (instanceId: string, driver: string, displayName: string, over: Partial<MyEngine> = {}): MyEngine => ({
  instanceId, driver, displayName, installed: true, subscription: { supported: false, signedIn: false }, myKey: false, orgKey: false, myTurns: "none", ...over,
});
const ORG = { org: { name: "Example", identity: { kind: "perspicax" as const, issuer: "https://px.example.test" } } };
const TOOL_NAMES = ["Codex", "Claude Code", "Grok", "Gemini CLI", "OpenAI-compatible"];

beforeEach(() => {
  setLocale("en");
  resetSettingsCards();
  fixture.org = null;
  fixture.mine = null;
  fixture.config = { viewer: { operator: true, role: "admin" } };
  fixture.instances = [];
  fixture.dispatch = vi.fn();
  fixture.local = { expose: false, share: false, connected: false, endpoints: [], published: [], probes: [] };
  fixture.piServers = [];
  fixture.keys = [];
  if (!("checkVisibility" in Element.prototype)) Object.defineProperty(Element.prototype, "checkVisibility", { configurable: true, value: () => true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Settings > Providers: the short list (#4329 B1)", () => {
  it("draws one row per provider, Other services and Advanced, and Add a provider as the card's last, primary action", async () => {
    fixture.instances = [instance("mistral", "mistral", "Mistral")];
    await render();
    expect(host.querySelector("[data-settings-intro]")).toBeNull();
    expect(host.querySelector("[data-providers-org-band]")).toBeNull();
    const row = host.querySelector<HTMLElement>('[data-provider="mistral"]')!;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain("Mistral");
    expect(row.querySelectorAll("[data-provider-action]")).toHaveLength(1);
    const services = host.querySelector('[data-settings-card="providers.services"]')!;
    expect(services.textContent).toContain("Web search");
    expect(services.querySelector('[data-settings-card="connections.image"]'), "image generation editable in solo").not.toBeNull();
    expect(host.querySelector('[data-settings-card="providers.advanced"]')).not.toBeNull();
    const add = host.querySelector<HTMLElement>('[data-settings-card="providers.list"] [data-add-provider-row] [data-add-provider-open]')!;
    expect(add.className).toContain("ui-button-primary");
    expect(row.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the old Model servers for pi card is gone from the page: each server is a row
    expect(host.querySelector('[data-settings-card="providers.modelServers"]')).toBeNull();
  });

  it("puts a second account on a second line with its own button, never a group that unfolds", async () => {
    fixture.instances = [
      instance("claude", "claudeAgent", "Claude Code", { access: "subscription", snapshot: { state: "available", authenticated: true, account: { email: "ada@example.com" } } }),
      instance("claude-work", "claudeAgent", "Claude work", { access: "subscription", snapshot: { state: "available", authenticated: true, account: { email: "ada.work@example.com" } } }),
    ];
    await render();
    const rows = host.querySelectorAll<HTMLElement>("[data-provider]");
    expect(rows).toHaveLength(1);
    const claude = rows[0]!;
    expect(claude.textContent).toContain("Claude");
    expect(claude.querySelectorAll("[data-provider-line]")).toHaveLength(2);
    expect(claude.textContent).toContain("ada@example.com");
    expect(claude.textContent).toContain("ada.work@example.com");
    expect(claude.querySelector("[aria-expanded]"), "no disclosure").toBeNull();
    expect(host.querySelector("[data-provider-group-rows]")).toBeNull();
  });

  it("shows OpenAI once for its two sign-ins, the xAI group under the owner's label, and no tool name or address on the first level", async () => {
    fixture.instances = [
      instance("codex", "codex", "Codex", { access: "subscription" }),
      instance("chatgpt", "codex", "ChatGPT plan", { access: "subscription" }),
      instance("grok", "grokAgent", "Grok", { access: "subscription" }),
      instance("compat-lab", "openai-compat", "Lab", { access: "custom" }),
    ];
    fixture.config = { viewer: { operator: true, role: "admin" }, openaiCompatServers: [{ instanceId: "compat-lab", name: "Home server", url: "https://lab.example.test/v1", configured: true }] };
    await render();
    const list = host.querySelector<HTMLElement>("[data-providers-active]")!;
    expect([...list.querySelectorAll("[data-provider]")].map((row) => row.getAttribute("data-provider"))).toEqual(["openai", "xai", "server:compat-lab"]);
    expect(list.querySelector('[data-provider="xai"]')!.textContent).toContain(XAI_GROUP_LABEL);
    const text = visibleText(list);
    for (const name of TOOL_NAMES) expect(text, name).not.toContain(name);
    expect(text).not.toContain("lab.example.test");
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("says a session expired in words and offers Sign in again", async () => {
    fixture.instances = [instance("claude", "claudeAgent", "Claude Code", { access: "subscription" })];
    fixture.org = ORG;
    fixture.config = { viewer: { operator: false, role: "member" } };
    fixture.mine = [mine("claude", "claudeAgent", "Claude Code", { subscription: { supported: true, signedIn: true, expired: true }, myTurns: "expired" })];
    await render();
    const row = host.querySelector<HTMLElement>('[data-provider="anthropic"]')!;
    expect(row.textContent).toContain("Session expired");
    expect(row.querySelector('[data-provider-action="signInAgain"]')!.textContent).toBe("Sign in again");
  });

  it("opens the provider's page from its row, and on the line a button names", async () => {
    fixture.instances = [instance("mistral", "mistral", "Mistral")];
    await render();
    await click(host.querySelector('[data-provider-open="mistral"]'));
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "toggleAppSettings", open: true, section: "providers", subPage: "providers.provider:mistral" });
  });

  it("never cuts a long server name or email: the row wraps instead", async () => {
    fixture.instances = [instance("claude", "claudeAgent", "Claude Code", { access: "subscription", snapshot: { state: "available", authenticated: true, account: { email: "research.team.shared.account@example.com" } } })];
    await render();
    const row = host.querySelector<HTMLElement>('[data-provider="anthropic"]')!;
    expect(row.querySelectorAll(".truncate")).toHaveLength(0);
  });

  it("a saved key's Remove removes the key after one confirm, as its word says, and never just opens the key", async () => {
    fixture.instances = [instance("mistral", "mistral", "Mistral")];
    await render();
    vi.mocked(apiMock).mockClear();
    fixture.dispatch.mockClear();
    const remove = host.querySelector('[data-provider="mistral"] [data-provider-action="remove"] button')!;
    expect(remove.textContent).toBe("Remove");
    await click(remove);
    expect(apiCalls("DELETE"), "the first click only asks to confirm").toHaveLength(0);
    expect(remove.textContent).toBe("Confirm removal");
    await click(remove);
    expect(apiCalls("DELETE")).toEqual([["/api/me/providers/keys/mistral", null]]);
    expect(fixture.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ subPage: "providers.provider:mistral" }));
  });

  it("draws Remove as the same grey pill as the row's other buttons; only its armed words turn red", async () => {
    fixture.local = { expose: true, share: false, connected: true, endpoints: [{ id: "e1", label: "", baseUrl: "http://127.0.0.1:8000/v1" }], published: [{ id: "e1", label: "", models: ["a"] }], probes: [] };
    fixture.instances = [instance("mistral", "mistral", "Mistral")];
    await render();
    const remove = host.querySelector<HTMLElement>('[data-provider="mistral"] [data-provider-action="remove"] button')!;
    const turnOff = host.querySelector<HTMLElement>('[data-provider="computer"] [data-provider-action="turnOff"]')!;
    expect(turnOff).not.toBeNull();
    expect(remove.className).toBe(turnOff.className);
    expect(remove.className).not.toContain("text-danger");
    await click(remove);
    expect(remove.getAttribute("data-confirm-pill")).toBe("armed");
    expect(remove.className).toContain("h-[26px]");
    expect(remove.className).toContain("text-danger");
  });

  it("a server's Remove on the list asks to confirm as the server's own page does, then removes it", async () => {
    fixture.instances = [instance("pi", "piAgent", "pi", { access: "custom" })];
    fixture.piServers = [{ id: "sx-1", name: "oMLX", url: "http://127.0.0.1:8000/v1", configured: false, models: [{ id: "qwen" }], provider: "px-own-sx-1" }];
    await render();
    vi.mocked(apiMock).mockClear();
    const remove = host.querySelector('[data-provider="pi-server:sx-1"] [data-provider-action="remove"] button')!;
    await click(remove);
    expect(apiCalls("DELETE"), "one click never deletes").toHaveLength(0);
    expect(remove.getAttribute("data-confirm-pill")).toBe("armed");
    expect(remove.textContent).toBe("Remove the server");
    await click(remove);
    expect(apiCalls("DELETE")).toEqual([["/api/me/pi-model-servers/sx-1", null]]);
  });

  it("lists this computer when it is on, with Turn off; a server for pi as a provider of its own", async () => {
    fixture.local = { expose: true, share: false, connected: true, endpoints: [{ id: "e1", label: "", baseUrl: "http://127.0.0.1:8000/v1" }], published: [{ id: "e1", label: "", models: ["a", "b", "c"] }], probes: [] };
    fixture.instances = [instance("pi", "piAgent", "pi", { access: "custom" })];
    fixture.piServers = [{ id: "sx-1", name: "oMLX", url: "http://127.0.0.1:8000/v1", configured: false, models: [{ id: "qwen" }], provider: "px-own-sx-1" }];
    await render();
    const computer = host.querySelector<HTMLElement>('[data-provider="computer"]')!;
    expect(computer.textContent).toContain("This computer");
    expect(computer.textContent).toContain("3 models");
    expect(computer.querySelector('[data-provider-action="turnOff"]')).not.toBeNull();
    const server = host.querySelector<HTMLElement>('[data-provider="pi-server:sx-1"]')!;
    expect(server.textContent).toContain("oMLX");
    expect(server.textContent).not.toContain("127.0.0.1");
  });
});

describe("Add a provider (#4329 B2): one list, then one step", () => {
  it("lists sign-ins, keys and something else in two columns, never one already connected, and searches", async () => {
    fixture.instances = [
      instance("claude", "claudeAgent", "Claude Code", { access: "subscription" }),
      instance("codex", "codex", "Codex", { access: "subscription", snapshot: { state: "available", authenticated: false } }),
    ];
    await render();
    await click(host.querySelector("[data-add-provider-open]"));
    const add = host.querySelector<HTMLElement>("[data-add-provider]")!;
    expect(add.dataset.step).toBe("choose");
    const signIn = add.querySelector('[data-add-provider-section="signIn"]')!;
    expect(signIn.querySelector("ul")!.className).toContain("grid-cols-2");
    expect(signIn.querySelector('[data-add-provider-choice="openai"]')!.textContent).toContain("OpenAI");
    expect(add.querySelector('[data-add-provider-choice="anthropic"]'), "connected: not offered").toBeNull();
    // OpenAI is a sign-in, so its key is behind "Use a key instead", not a second entry
    expect(add.querySelectorAll('[data-add-provider-choice="openai"]')).toHaveLength(1);
    expect(add.querySelector('[data-add-provider-section="keys"] [data-add-provider-choice="mistral"]')).not.toBeNull();
    expect(add.querySelector('[data-add-provider-section="other"] [data-add-provider-choice="server"]')).not.toBeNull();
    expect(add.querySelector('[data-add-provider-section="other"] [data-add-provider-choice="computer"]')).not.toBeNull();
    const search = add.querySelector<HTMLInputElement>("[data-add-provider-search]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "mist");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect([...add.querySelectorAll("[data-add-provider-choice]")].map((node) => node.getAttribute("data-add-provider-choice"))).toEqual(["mistral"]);
  });

  it("a key: one field and one button; a sign-in: the provider's page on that account", async () => {
    fixture.instances = [instance("codex", "codex", "Codex", { access: "subscription", snapshot: { state: "available", authenticated: false } })];
    await render();
    await click(host.querySelector("[data-add-provider-open]"));
    await click(host.querySelector('[data-add-provider-choice="mistral"]'));
    expect(host.querySelector("[data-add-provider]")!.getAttribute("data-step")).toBe("personalKey");
    expect(host.querySelectorAll("[data-add-provider] input[type=password]")).toHaveLength(1);
    await click(host.querySelector('[data-add-provider] button[aria-label="Back"]'));
    await click(host.querySelector('[data-add-provider-choice="openai"]'));
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "toggleAppSettings", open: true, section: "providers", subPage: "providers.provider:openai" });
  });

  it("on a solo server, a server by its address is added one way only: through Another server, never as a key", async () => {
    fixture.instances = [instance("claude", "claudeAgent", "Claude Code", { access: "subscription" })];
    await render();
    await click(host.querySelector("[data-add-provider-open]"));
    const add = host.querySelector<HTMLElement>("[data-add-provider]")!;
    expect(add.querySelector('[data-add-provider-choice="key:openaiCompat"]')).toBeNull();
    expect(add.querySelector('[data-add-provider-choice="key:azureFoundry"]')).toBeNull();
    expect(visibleText(add)).not.toContain("OpenAI-compatible");
    await click(add.querySelector('[data-add-provider-choice="server"]'));
    const step = host.querySelector<HTMLElement>('[data-add-provider][data-step="server"]')!;
    expect(visibleText(step)).not.toContain("OpenAI-compatible");
    // the server's own setting (an address, an Azure resource) sits in the step's Advanced
    const more = step.querySelector<HTMLElement>("[data-add-server-advanced]")!;
    await click(more.querySelector("button[aria-expanded]"));
    expect(more.textContent).toContain("OpenAI-compatible server");
    expect(more.textContent).toContain("Azure AI Foundry");
  });

  it("offers nothing already connected (pure)", () => {
    const list = { groups: [{ id: "mistral" }], toConnect: [], instances: [], organization: true, manageKeys: false, accounts: { view: { keys: [{ provider: "openai", last4: null }], servers: [] } }, piServers: { servers: [] }, local: null };
    const choices = addChoices(list as never, null);
    const ids = choices.keys.map((choice) => choice.id);
    expect(ids).not.toContain("mistral");
    expect(ids).not.toContain("openai");
    expect(ids).toContain("anthropic");
  });
});

describe("One provider's page (#4329 B3)", () => {
  it("draws Accounts, Models and Advanced folded; Advanced holds who pays, the tool by its name and the identifier", async () => {
    fixture.instances = [instance("mistral", "mistral", "Mistral")];
    await page("mistral");
    const root = host.querySelector<HTMLElement>('[data-provider-page="mistral"]')!;
    expect(root.querySelector('[data-settings-group="provider-accounts"]')).not.toBeNull();
    expect(root.querySelector('[data-link-row="providers.models.mistral"]')!.textContent).toContain("2 of 2 on");
    const advanced = root.querySelector<HTMLElement>("[data-provider-page-advanced]")!;
    expect(advanced.hidden, "folded each time it opens").toBe(true);
    await click(root.querySelector('[data-settings-card="providers.page.advanced.mistral"] button[aria-expanded]'));
    expect(advanced.hidden).toBe(false);
    expect(advanced.querySelector('[data-settings-row^="providers.whoPays."]')).not.toBeNull();
    expect(advanced.querySelector("[data-engine-advanced], [data-provider-copy-id]")).not.toBeNull();
    // the models link goes to Models
    await click(root.querySelector('[data-link-row="providers.models.mistral"]'));
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "engines" });
  });

  it("opens Advanced when an old link asked for a row's card", async () => {
    fixture.instances = [instance("mistral", "mistral", "Mistral")];
    requestSettingsCard("providers.advanced.mistral");
    await page("mistral");
    expect(host.querySelector<HTMLElement>("[data-provider-page-advanced]")!.hidden).toBe(false);
  });

  it("lists every account of OpenAI by email or plan name, never the tool's name, until Advanced", async () => {
    fixture.instances = [
      instance("codex", "codex", "Codex", { access: "subscription", snapshot: { state: "available", authenticated: true, account: { email: "ada@example.com" } } }),
      instance("chatgpt", "codex", "ChatGPT plan", { access: "subscription", snapshot: { state: "available", authenticated: false } }),
    ];
    await page("openai");
    const accounts = host.querySelector<HTMLElement>('[data-settings-group="provider-accounts"]')!;
    expect(accounts.querySelectorAll("[data-provider-line]")).toHaveLength(2);
    expect(accounts.textContent).toContain("ada@example.com");
    expect(accounts.textContent).toContain("ChatGPT plan");
    expect(accounts.querySelector('[data-provider-line="account:chatgpt"] [data-provider-action="signIn"]')).not.toBeNull();
    const first = visibleText(host.querySelector('[data-provider-page="openai"]')!.firstElementChild!);
    expect(first).not.toContain("Codex");
    // Advanced names the tool
    expect(host.querySelector("[data-provider-page-advanced]")!.textContent).toContain("Codex");
  });

  it("keeps a second Claude account's Remove in reach when its line has no button (no sign-out on this computer)", async () => {
    const account = (configDir: string, isDefault: boolean) => ({ configDir, signInCommand: "claude auth login", signInShell: "sh" as const, isDefault });
    fixture.instances = [
      instance("claude", "claudeAgent", "Claude Code", { access: "subscription", claudeAccount: account("~/.claude", true), snapshot: { state: "available", authenticated: true, account: { email: "ada@example.com" } } }),
      instance("claude-alex", "claudeAgent", "Claude alex", { access: "subscription", claudeAccount: account("~/.claude-alex", false), snapshot: { state: "available", authenticated: true, account: { email: "alex@example.com" } } }),
    ];
    await page("anthropic");
    const line = host.querySelector<HTMLElement>('[data-provider-line="account:claude-alex"]')!;
    expect(line).not.toBeNull();
    expect(line.querySelector("[data-provider-action]"), "no sign-out on this computer: no button").toBeNull();
    await click(host.querySelector('[data-settings-card="providers.page.advanced.anthropic"] button[aria-expanded]'));
    const advanced = host.querySelector<HTMLElement>('[data-provider-advanced="account:claude-alex"]')!;
    expect(advanced.textContent).toContain("Check account");
    await click([...advanced.querySelectorAll<HTMLElement>("[data-inline-fold] > button")].find((button) => button.textContent?.includes("Manage account")));
    expect([...advanced.querySelectorAll("button")].some((button) => button.textContent === "Remove account")).toBe(true);
  });

  it("draws no empty block in Advanced for an account with nothing of its own to show", async () => {
    fixture.instances = [
      instance("claude", "claudeAgent", "Claude Code", { access: "subscription", snapshot: { state: "available", authenticated: true, account: { email: "ada@example.com" } } }),
      instance("claude-alex", "claudeAgent", "Claude alex", { access: "subscription", snapshot: { state: "available", authenticated: true, account: { email: "alex@example.com" } } }),
    ];
    await page("anthropic");
    const advanced = host.querySelector<HTMLElement>("[data-provider-page-advanced]")!;
    for (const block of advanced.querySelectorAll("[data-provider-advanced] > *")) {
      expect(block.childNodes.length + (block.textContent ?? "").length, block.outerHTML.slice(0, 80)).toBeGreaterThan(0);
    }
    for (const card of advanced.querySelectorAll("[data-engine-card]")) expect(card.childNodes.length).toBeGreaterThan(0);
  });

  it("on a solo server, a signed-in account's Advanced adds the server's key for that vendor", async () => {
    fixture.instances = [instance("claude", "claudeAgent", "Claude Code", { access: "subscription", snapshot: { state: "available", authenticated: true, account: { email: "ada@example.com" } } })];
    await page("anthropic");
    await click(host.querySelector('[data-settings-card="providers.page.advanced.anthropic"] button[aria-expanded]'));
    await click(host.querySelector('[data-provider-add-key-open="account:claude"]'));
    expect(host.querySelector('[data-provider-add-key] [data-provider-key-dialog="anthropic"]')).not.toBeNull();
  });

  it("keeps a saved key's Change key in Advanced: it opens the line's key", async () => {
    fixture.instances = [instance("mistral", "mistral", "Mistral")];
    await page("mistral");
    expect(host.querySelector("[data-personal-provider-key]")).toBeNull();
    await click(host.querySelector('[data-settings-card="providers.page.advanced.mistral"] button[aria-expanded]'));
    await click(host.querySelector("[data-provider-change-key]"));
    expect(host.querySelector('[data-provider-panel] [data-personal-provider-key="mistral"]')).not.toBeNull();
  });

  it("says what belongs to the tool once per tool: one connectors sentence and one CLI path fold for two Claude accounts", async () => {
    fixture.instances = [
      instance("claude", "claudeAgent", "Claude Code", { access: "subscription", cliDefault: "claude", snapshot: { state: "available", authenticated: true, version: "2.1.0", account: { email: "ada@example.com" } } }),
      instance("claude-alex", "claudeAgent", "Claude alex", { access: "subscription", cliDefault: "claude", snapshot: { state: "available", authenticated: true, version: "2.1.0", account: { email: "alex@example.com" } } }),
    ];
    await page("anthropic");
    const advanced = host.querySelector<HTMLElement>("[data-provider-page-advanced]")!;
    expect(advanced.querySelectorAll('[data-engine-connectors="claudeAgent"]')).toHaveLength(1);
    expect(advanced.querySelectorAll('[data-settings-card^="providers.advanced."]')).toHaveLength(1);
    // each account still has its own identifier
    expect(advanced.querySelectorAll("[data-provider-copy-id]")).toHaveLength(2);
  });

  it("this computer's page holds its full models settings (from Settings > Computer)", async () => {
    fixture.local = { expose: true, share: false, connected: true, endpoints: [], published: [], probes: [] };
    await page("computer");
    const settings = host.querySelector<HTMLElement>('[data-provider-page="computer"] [data-settings-card="providers.localModels"]')!;
    expect(settings).not.toBeNull();
    expect(settings.dataset.localModels).toBe("on");
  });
});

describe("Settings > Providers, in an organization", () => {
  beforeEach(() => {
    fixture.org = ORG;
    fixture.config = { viewer: { operator: false, role: "admin" } };
    fixture.instances = [instance("mistral", "mistral", "Mistral"), instance("codex", "codex", "Codex", { access: "subscription" })];
    fixture.mine = [
      mine("mistral", "mistral", "Mistral", { orgKey: true, myTurns: "org-key" }),
      mine("codex", "codex", "Codex", { subscription: { supported: true, signedIn: true }, myTurns: "subscription" }),
    ];
  });

  it("hides the organization band and what the organization pays for (it still applies, out of sight)", async () => {
    await render();
    expect(host.querySelector("[data-providers-org-band]")).toBeNull();
    expect(host.querySelector("[data-org-band]")).toBeNull();
    expect(host.querySelector('[data-provider="mistral"]')).toBeNull();
    expect(host.querySelector('a[href*="/console/settings"]')).toBeNull();
    expect(host.querySelector("[data-view-as-member]"), "no View as a member").toBeNull();
  });

  it("a member signed in with a vendor still adds their own key for it, in the page's Advanced (the key Grok voice uses, say)", async () => {
    await page("openai");
    expect(host.querySelector('[data-provider-line="account:codex"] [data-provider-action="signOut"]')).not.toBeNull();
    await click(host.querySelector('[data-settings-card="providers.page.advanced.openai"] button[aria-expanded]'));
    const open = host.querySelector<HTMLElement>('[data-provider-add-key-open="account:codex"]')!;
    expect(open, "Add key in Advanced of the signed-in account").not.toBeNull();
    expect(open.textContent).toBe("Add key");
    await click(open);
    const input = host.querySelector<HTMLInputElement>('[data-provider-add-key] [data-personal-provider-key-input="openai"]')!;
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "sk-test-123");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    vi.mocked(apiMock).mockClear();
    await click([...host.querySelectorAll<HTMLElement>("[data-provider-add-key] button")].find((button) => button.textContent === "Save"));
    expect(apiCalls("PUT")).toEqual([["/api/me/providers/keys/openai", JSON.stringify({ key: "sk-test-123" })]]);
  });

  it("offers the key once: not in Advanced when a line of the page already holds it", async () => {
    fixture.keys = [{ provider: "openai", last4: "1234" }];
    await page("openai");
    expect(host.querySelector('[data-provider-line="personal-key:openai"]'), "the saved key is a line of its own").not.toBeNull();
    expect(host.querySelector("[data-provider-add-key-open]")).toBeNull();
  });

  it("keeps the person's own sign-in with Sign out, and image generation read-only", async () => {
    await render();
    const openai = host.querySelector<HTMLElement>('[data-provider="openai"]')!;
    expect(openai).not.toBeNull();
    expect(openai.querySelector('[data-provider-action="signOut"]')!.textContent).toBe("Sign out");
    const services = host.querySelector('[data-settings-card="providers.services"]')!;
    expect(services.querySelector('[data-settings-card="connections.image"]')).toBeNull();
    expect(services.querySelector('[data-settings-row="providers.imageGen"]')).not.toBeNull();
  });
});
