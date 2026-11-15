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
  accountsDown: false,
  harnessByProvider: {} as Record<string, string>,
}));

const answers = (path: string, init?: RequestInit): unknown => {
  if (path === "/api/me/models") {
    const body = JSON.parse(String(init?.body ?? "{}")) as { disabledModels?: string[]; harnessByProvider?: Record<string, string> };
    if (body.harnessByProvider) fixture.harnessByProvider = { ...fixture.harnessByProvider, ...body.harnessByProvider };
    return { mine: body.disabledModels ?? [], harnessByProvider: fixture.harnessByProvider };
  }
  if (path.startsWith("/api/instances/")) return { instances: fixture.instances };
  if (/^\/api\/me\/engines\/[^/]+\/name$/.test(path)) return { ok: true };
  if (path === "/api/me/providers") {
    if (fixture.accountsDown) throw new Error("personal keys unreachable");
    return { keys: fixture.keys, servers: [] };
  }
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
    api: vi.fn(async (path: string, init?: RequestInit) => answers(path, init)),
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
  fixture.accountsDown = false;
  fixture.harnessByProvider = {};
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
  it("draws one row per provider, Other services and Advanced, and Add a provider as the list's last row, drawn as a row (#4376)", async () => {
    fixture.instances = [instance("mistral", "mistral", "Mistral")];
    await render();
    expect(host.querySelector("[data-settings-intro]")).toBeNull();
    expect(host.querySelector("[data-providers-org-band]")).toBeNull();
    const row = host.querySelector<HTMLElement>('[data-provider="mistral"]')!;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain("Mistral");
    expect(row.querySelector("[data-provider-summary]")!.textContent).toBe("Connected");
    expect(row.querySelectorAll("[data-provider-action]"), "a connected provider carries no button").toHaveLength(0);
    const services = host.querySelector('[data-settings-card="providers.services"]')!;
    expect(services.textContent).toContain("Web search");
    expect(services.querySelector('[data-settings-card="connections.image"]'), "image generation editable in solo").not.toBeNull();
    expect(host.querySelector('[data-settings-card="providers.advanced"]')).not.toBeNull();
    const add = host.querySelector<HTMLElement>('[data-settings-card="providers.list"] [data-add-provider-row] [data-add-provider-open]')!;
    expect(add.className, "a row of the list, not a pill of another kind").not.toContain("ui-button");
    expect(add.className).toContain("rounded-2xl");
    expect(add.className).toContain("min-h-16");
    expect(add.textContent).toBe("Add a provider");
    expect(row.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the old Model servers for pi card is gone from the page: each server is a row
    expect(host.querySelector('[data-settings-card="providers.modelServers"]')).toBeNull();
  });

  it("draws a provider with two accounts as ONE row: one target, one summary, no second line, no Sign out (#4376)", async () => {
    fixture.instances = [
      instance("claude", "claudeAgent", "Claude Code", { access: "subscription", authentication: { method: "browser" as const, signOut: true }, snapshot: { state: "available", authenticated: true, account: { email: "ada@example.com" } } }),
      instance("claude-work", "claudeAgent", "Claude work", { access: "subscription", authentication: { method: "browser" as const, signOut: true }, snapshot: { state: "available", authenticated: true, account: { email: "ada.work@example.com" } } }),
    ];
    await render();
    const rows = host.querySelectorAll<HTMLElement>("[data-provider]");
    expect(rows).toHaveLength(1);
    const claude = rows[0]!;
    expect(claude.textContent).toContain("Claude");
    expect(claude.querySelector("[data-provider-summary]")!.textContent).toBe("2 accounts connected");
    expect(claude.querySelectorAll("[data-provider-line], [data-provider-line-row]"), "no second line").toHaveLength(0);
    expect(claude.querySelectorAll("[data-provider-action]"), "signing out is on the page").toHaveLength(0);
    expect(claude.querySelectorAll("button"), "one target").toHaveLength(1);
    expect(claude.textContent).not.toContain("ada@example.com");
    // the target spans the whole row, under the words; the hover belongs to the whole row
    const open = claude.querySelector<HTMLElement>("[data-provider-open]")!;
    expect(open.className).toContain("absolute inset-0");
    expect(open.getAttribute("aria-label")).toBe("Claude, 2 accounts connected");
    expect(claude.querySelector<HTMLElement>("[data-provider-row-body]")!.className).toContain("pointer-events-none");
    expect(claude.className).toContain("hover:bg-ink/[0.05]");
    expect(claude.querySelector("[aria-expanded]"), "no disclosure").toBeNull();
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

  it("says on the row, in amber, that one account of a connected provider must sign in again, with its Sign in again (#4376 review)", async () => {
    fixture.instances = [
      instance("claude", "claudeAgent", "Claude Code", { access: "subscription" }),
      instance("claude-work", "claudeAgent", "Claude work", { access: "subscription" }),
    ];
    fixture.org = ORG;
    fixture.config = { viewer: { operator: false, role: "member" } };
    fixture.mine = [
      mine("claude", "claudeAgent", "Claude Code", { subscription: { supported: true, signedIn: true }, myTurns: "subscription" }),
      mine("claude-work", "claudeAgent", "Claude work", { subscription: { supported: true, signedIn: true, expired: true }, myTurns: "expired" }),
    ];
    await render();
    const row = host.querySelector<HTMLElement>('[data-provider="anthropic"]')!;
    const summary = row.querySelector("[data-provider-summary]")!;
    expect(summary.textContent).toBe("Connected · 1 account to sign in again");
    expect(summary.querySelector("[data-status-text]")!.getAttribute("data-status-text"), "amber, not neutral grey").toBe("warning");
    expect(row.querySelector('[data-provider-action="signInAgain"]')!.textContent).toBe("Sign in again");
    setLocale("fr");
    await render();
    expect(host.querySelector('[data-provider="anthropic"] [data-provider-summary]')!.textContent).toBe("Connecté · 1 compte à reconnecter");
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

  it("a saved key's Remove sits in the page's API key section and removes the key after one confirm (#4376)", async () => {
    fixture.instances = [instance("mistral", "mistral", "Mistral")];
    await render();
    expect(host.querySelector('[data-provider="mistral"] [data-provider-action]'), "nothing to remove from the list").toBeNull();
    await page("mistral");
    vi.mocked(apiMock).mockClear();
    const remove = host.querySelector('[data-settings-group="provider-key"] [data-provider-action="remove"] button')!;
    expect(remove.textContent).toBe("Remove");
    await click(remove);
    expect(apiCalls("DELETE"), "the first click only asks to confirm").toHaveLength(0);
    expect(remove.textContent).toBe("Confirm removal");
    await click(remove);
    expect(apiCalls("DELETE")).toEqual([["/api/me/providers/keys/mistral", null]]);
  });

  it("draws Remove as the same grey pill as Replace beside it; only its armed words turn red", async () => {
    fixture.instances = [instance("mistral", "mistral", "Mistral")];
    await page("mistral");
    const remove = host.querySelector<HTMLElement>('[data-settings-group="provider-key"] [data-provider-action="remove"] button')!;
    const replace = host.querySelector<HTMLElement>('[data-settings-group="provider-key"] [data-provider-change-key]')!;
    expect(replace.textContent).toBe("Replace");
    expect(remove.className).toBe(replace.className);
    expect(remove.className).not.toContain("text-danger");
    await click(remove);
    expect(remove.getAttribute("data-confirm-pill")).toBe("armed");
    expect(remove.className).toContain("h-[26px]");
    expect(remove.className).toContain("text-danger");
  });

  it("a server for pi is one row with no button: its Remove is on its page (#4376)", async () => {
    fixture.instances = [instance("pi", "piAgent", "pi", { access: "custom" })];
    fixture.piServers = [{ id: "sx-1", name: "oMLX", url: "http://127.0.0.1:8000/v1", configured: false, models: [{ id: "qwen" }], provider: "px-own-sx-1" }];
    await render();
    const row = host.querySelector<HTMLElement>('[data-provider="pi-server:sx-1"]')!;
    expect(row.querySelector("[data-provider-action]")).toBeNull();
    expect(row.querySelector("[data-provider-summary]")!.textContent).toBe("1 model");
    await click(row.querySelector("[data-provider-open]"));
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "toggleAppSettings", open: true, section: "providers", subPage: "providers.provider:pi-server:sx-1" });
  });

  it("lists this computer when it is on by its models, its switch on its page; a server for pi as a provider of its own", async () => {
    fixture.local = { expose: true, share: false, connected: true, endpoints: [{ id: "e1", label: "", baseUrl: "http://127.0.0.1:8000/v1" }], published: [{ id: "e1", label: "", models: ["a", "b", "c"] }], probes: [] };
    fixture.instances = [instance("pi", "piAgent", "pi", { access: "custom" })];
    fixture.piServers = [{ id: "sx-1", name: "oMLX", url: "http://127.0.0.1:8000/v1", configured: false, models: [{ id: "qwen" }], provider: "px-own-sx-1" }];
    await render();
    const computer = host.querySelector<HTMLElement>('[data-provider="computer"]')!;
    expect(computer.textContent).toContain("This computer");
    expect(computer.querySelector("[data-provider-summary]")!.textContent).toBe("3 models on this computer");
    expect(computer.querySelector("[data-provider-action]"), "Turn off is on its page").toBeNull();
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
  it("a key-only provider: its API key section, its models in place, Advanced folded; no Accounts, no Runs with (#4376)", async () => {
    fixture.instances = [instance("mistral", "mistral", "Mistral")];
    await page("mistral");
    const root = host.querySelector<HTMLElement>('[data-provider-page="mistral"]')!;
    expect(root.querySelector('[data-settings-group="provider-accounts"]'), "a key is not an account").toBeNull();
    expect(root.querySelector('[data-settings-group="provider-key"]')!.textContent).toContain("A key is saved");
    expect(root.querySelector("[data-provider-runs-with], [data-settings-group=\"provider-runs-with\"]"), "one engine only can run it: nothing to choose").toBeNull();
    const models = root.querySelector<HTMLElement>('[data-settings-group="provider-models"]')!;
    expect(models.querySelector("h3")!.textContent).toBe("Models");
    expect(models.textContent).toContain("2 of 2 on");
    expect(models.querySelector("[data-count-pill]")!.textContent!.trim(), "the line says the count; the pill does not say it again").toBe("");
    expect(models.querySelector("[data-link-row]"), "never sent to another page").toBeNull();
    const advanced = root.querySelector<HTMLElement>("[data-provider-page-advanced]")!;
    expect(advanced.hidden, "folded each time it opens").toBe(true);
    await click(root.querySelector('[data-settings-card="providers.page.advanced.mistral"] button[aria-expanded]'));
    expect(advanced.hidden).toBe(false);
    expect(advanced.querySelector('[data-settings-row^="providers.whoPays."]')).not.toBeNull();
    expect(advanced.querySelector("[data-engine-advanced], [data-provider-copy-id]")).not.toBeNull();
  });

  it("unfolds the models in place, one switch each, on the same state Active models reads (#4376)", async () => {
    fixture.instances = [instance("mistral", "mistral", "Mistral")];
    fixture.config = { viewer: { operator: true, role: "admin" }, myDisabledModels: [] };
    await page("mistral");
    const models = host.querySelector<HTMLElement>('[data-provider-models="mistral"]')!;
    await click(models.querySelector("button[aria-expanded]"));
    const switches = models.querySelectorAll<HTMLElement>("[data-model-switch] button[role=switch]");
    expect(switches).toHaveLength(2);
    vi.mocked(apiMock).mockClear();
    await click(switches[0]);
    const [[path, body]] = apiCalls("PUT") as [[string, string]];
    expect(path).toBe("/api/me/models");
    expect(JSON.parse(body).disabledModels).toHaveLength(1);
    // the store's config now holds it: Settings > Models > Active models reads the same
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "configStatus", config: expect.objectContaining({ myDisabledModels: JSON.parse(body).disabledModels }) });
    expect(fixture.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ section: "engines" }));
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

  it("on a solo server, the API key section offers the server's key for a signed-in vendor (#4376: never a row of Accounts)", async () => {
    fixture.instances = [instance("claude", "claudeAgent", "Claude Code", { access: "subscription", snapshot: { state: "available", authenticated: true, account: { email: "ada@example.com" } } })];
    await page("anthropic");
    const accounts = host.querySelector<HTMLElement>('[data-settings-group="provider-accounts"]')!;
    expect(accounts.textContent).not.toContain("Key");
    const key = host.querySelector<HTMLElement>('[data-settings-group="provider-key"]')!;
    expect(key.textContent).toContain("No key saved");
    await click(key.querySelector("[data-provider-add-key-open]"));
    expect(key.querySelector('[data-provider-add-key] [data-provider-key-dialog="anthropic"]')).not.toBeNull();
  });

  it("a saved key's Replace opens the key's form in place, in the API key section", async () => {
    fixture.instances = [instance("mistral", "mistral", "Mistral")];
    await page("mistral");
    expect(host.querySelector("[data-personal-provider-key]")).toBeNull();
    await click(host.querySelector('[data-settings-group="provider-key"] [data-provider-change-key]'));
    expect(host.querySelector('[data-settings-group="provider-key"] [data-provider-panel] [data-personal-provider-key="mistral"]')).not.toBeNull();
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
  it("opens a key setup on Add key for a key engine with no key row of its own: Groq on a solo server (#4376 review)", async () => {
    // no personal key list to take it (the server's personal keys unreachable): the engine's own setup
    fixture.accountsDown = true;
    fixture.instances = [instance("groq", "groq", "Groq", { snapshot: { state: "unavailable", reason: "No API key." } })];
    await page("groq");
    const line = host.querySelector<HTMLElement>('[data-provider-line="engine:groq"]')!;
    expect(line, "the key line of the engine").not.toBeNull();
    await click(line.querySelector('[data-provider-action="addKey"]'));
    const panel = host.querySelector<HTMLElement>('[data-provider-panel="engine:groq"]')!;
    expect(panel, "Add key opens a panel").not.toBeNull();
    expect(panel.children.length, "the panel is never empty").toBeGreaterThan(0);
    expect(panel.querySelector('[data-engine-api-key="groq"] input'), "the engine's key field").not.toBeNull();
  });
});

describe("A provider's accounts (#4376: named, renamed in place, the key never one of them)", () => {
  const signedIn = (email: string) => ({ access: "subscription" as const, authentication: { method: "browser" as const, signOut: true }, snapshot: { state: "available" as const, authenticated: true, account: { email } } });

  it("names each account, its sign-in address and state under the name, one button; a sensible default, never the provider's or the tool's name", async () => {
    fixture.instances = [
      instance("codex", "codex", "Codex", signedIn("ada@example.com")),
      instance("codex-2", "codex", "OpenAI", signedIn("ada.work@example.com")),
      instance("chatgpt", "codex", "ChatGPT plan", { access: "subscription", snapshot: { state: "available", authenticated: false } }),
    ];
    await page("openai");
    const lines = [...host.querySelectorAll<HTMLElement>('[data-settings-group="provider-accounts"] [data-provider-account]')];
    expect(lines.map((line) => line.querySelector("[data-account-name]")!.textContent)).toEqual(["Account 1", "Account 2", "ChatGPT plan"]);
    const ada = host.querySelector<HTMLElement>('[data-provider-line="account:codex"]')!;
    expect(ada.querySelector("[data-provider-account-line]")!.textContent).toBe("ada@example.com · Connected");
    expect(ada.querySelectorAll("[data-provider-action]")).toHaveLength(1);
    expect(ada.querySelector('[data-provider-action="signOut"]')!.getAttribute("aria-label")).toBe("Sign out · Account 1");
    expect(host.querySelector('[data-provider-line="account:chatgpt"] [data-provider-action="signIn"]')).not.toBeNull();
  });

  it("calls a lone account 'Your account' when its own name is only the tool's", async () => {
    fixture.instances = [instance("codex", "codex", "Codex", signedIn("ada@example.com"))];
    await page("openai");
    expect(host.querySelector('[data-account-name="account:codex"]')!.textContent).toBe("Your account");
  });

  it("renames an account on a solo server: a click on its name, type, Enter (PATCH /api/instances/:id)", async () => {
    fixture.instances = [instance("codex", "codex", "Codex", signedIn("ada@example.com"))];
    await page("openai");
    await click(host.querySelector('[data-account-name="account:codex"]'));
    const input = host.querySelector<HTMLInputElement>('[data-account-name-input="account:codex"]')!;
    expect(input.value).toBe("Your account");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "  Work plan ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    vi.mocked(apiMock).mockClear();
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await settle();
    expect(apiCalls("PATCH")).toEqual([["/api/instances/codex", JSON.stringify({ displayName: "Work plan" })]]);
    expect(host.querySelector("[data-account-name-input]"), "back to the name").toBeNull();
  });

  it("Escape leaves the name as it was, and saves nothing", async () => {
    fixture.instances = [instance("codex", "codex", "Codex", signedIn("ada@example.com"))];
    await page("openai");
    await click(host.querySelector('[data-account-rename="account:codex"]'));
    const input = host.querySelector<HTMLInputElement>('[data-account-name-input="account:codex"]')!;
    vi.mocked(apiMock).mockClear();
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await settle();
    expect(host.querySelector("[data-account-name-input]")).toBeNull();
    expect(apiCalls("PATCH")).toEqual([]);
  });

  it("the xAI provider with its bots there: one row 'Connected · your bots there too', Disconnect on its page only", async () => {
    fixture.instances = [instance("grok", "grokAgent", "Grok", signedIn("ada@example.com"))];
    const bridge = { linked: true, enabled: true, orgAllowed: true, keySet: true, bots: ["Scout"], mayCallOwner: false, mayTextOwner: true, webhookUrl: "https://bots.example.test/hook" };
    vi.mocked(apiMock).mockImplementation(async (path: string, init?: RequestInit) => (path === "/api/me/grok-bridge" ? bridge : answers(path, init)));
    try {
      await render();
      const rows = host.querySelectorAll<HTMLElement>('[data-provider="xai"]');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.querySelector("[data-provider-summary]")!.textContent).toBe("Connected · your bots there too");
      expect(rows[0]!.querySelector("[data-bots-link-action], [data-provider-action]")).toBeNull();
      expect(rows[0]!.getAttribute("data-settings-row"), "a search still finds the link").toBe("providers.botsLink");
    } finally {
      vi.mocked(apiMock).mockImplementation(async (path: string, init?: RequestInit) => answers(path, init));
    }
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

  it("a member signed in with a vendor still adds their own key for it, in the page's API key section (the key Grok voice uses, say)", async () => {
    await page("openai");
    expect(host.querySelector('[data-provider-line="account:codex"] [data-provider-action="signOut"]')).not.toBeNull();
    const open = host.querySelector<HTMLElement>('[data-settings-group="provider-key"] [data-provider-add-key-open]')!;
    expect(open, "Add key in the API key section").not.toBeNull();
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

  it("keeps the person's own sign-in: Connected on the list, Sign out on the page; image generation read-only", async () => {
    await render();
    const openai = host.querySelector<HTMLElement>('[data-provider="openai"]')!;
    expect(openai).not.toBeNull();
    expect(openai.querySelector("[data-provider-summary]")!.textContent).toBe("Connected");
    expect(openai.querySelector("[data-provider-action]")).toBeNull();
    await page("openai");
    expect(host.querySelector('[data-provider-line="account:codex"] [data-provider-action="signOut"]')!.textContent).toBe("Sign out");
    await render();
    const services = host.querySelector('[data-settings-card="providers.services"]')!;
    expect(services.querySelector('[data-settings-card="connections.image"]')).toBeNull();
    expect(services.querySelector('[data-settings-row="providers.imageGen"]')).not.toBeNull();
  });

  it("renames an account for this person alone: PUT /api/me/engines/:id/name (#4376)", async () => {
    await page("openai");
    await click(host.querySelector('[data-account-rename="account:codex"]'));
    const input = host.querySelector<HTMLInputElement>('[data-account-name-input="account:codex"]')!;
    expect(input.closest("[data-keeps-escape]"), "Escape cancels the rename, not the page").not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Team plan");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    vi.mocked(apiMock).mockClear();
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await settle();
    expect(apiCalls("PUT")).toEqual([["/api/me/engines/codex/name", JSON.stringify({ name: "Team plan" })]]);
    expect(apiCalls("PATCH"), "never the organization's engine").toEqual([]);
  });

  it("gives an account its default name back when the person empties the name (#4376 review)", async () => {
    await page("openai");
    await click(host.querySelector('[data-account-rename="account:codex"]'));
    const input = host.querySelector<HTMLInputElement>('[data-account-name-input="account:codex"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    vi.mocked(apiMock).mockClear();
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await settle();
    expect(apiCalls("PUT")).toEqual([["/api/me/engines/codex/name", JSON.stringify({ name: "" })]]);
  });
});

// #4384 (#4329 lot 6): "Runs with" on the provider's page, the answer on
// screen to "how do I use pi with this provider": between the API key (or
// Your bots there) and Models, its words in plain language, the tool named
// only in the opened list, a pick saved as the person's default for it.
describe("Runs with on a provider's page (#4384)", () => {
  const openaiKey = () => instance("openai", "openai-compat", "OpenAI", { models: { default: "gpt-6", options: [{ id: "gpt-6", label: "GPT-6" }] } });
  const pi = () => instance("pi", "piAgent", "pi", { access: "custom", models: { default: "openai/gpt-6", options: [{ id: "openai/gpt-6", label: "GPT-6" }] } });

  it("says what runs the bots with this provider, between the key and Models, and saves the pick as the person's default", async () => {
    fixture.instances = [openaiKey(), pi()];
    await page("openai");
    const root = host.querySelector<HTMLElement>('[data-provider-page="openai"]')!;
    const section = root.querySelector<HTMLElement>('[data-settings-group="provider-runs-with"]');
    expect(section, "drawn: built in and pi can both run it").not.toBeNull();
    const key = root.querySelector('[data-settings-group="provider-key"]')!;
    const models = root.querySelector('[data-settings-group="provider-models"]')!;
    expect(key.compareDocumentPosition(section!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section!.compareDocumentPosition(models) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(visibleText(section!)).toContain("Runs with");
    expect(visibleText(section!)).toContain("What runs your bots when they use OpenAI.");
    const pill = section!.querySelector<HTMLButtonElement>('[data-runs-with="settings"] button[data-pill-select]')!;
    expect(pill.textContent).toBe("Built in (recommended)");
    for (const name of TOOL_NAMES) expect(visibleText(section!), name).not.toContain(name);
    await click(pill);
    const options = [...document.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual([
      "Built in (recommended)Sagax talks to the provider directly",
      "piAn open engine that works with many providers",
    ]);
    await click(options[1]);
    expect(apiCalls("PUT")).toEqual([["/api/me/models", JSON.stringify({ harnessByProvider: { openai: "piAgent" } })]]);
    expect(section!.querySelector('[data-runs-with="settings"]')!.getAttribute("data-runs-with-value")).toBe("piAgent");
    expect(section!.querySelector("button[data-pill-select]")!.textContent).toBe("pi");
  });

  it("reads the person's saved default, in Quebec French", async () => {
    setLocale("fr");
    fixture.instances = [openaiKey(), pi()];
    fixture.harnessByProvider = { openai: "piAgent" };
    await page("openai");
    const section = host.querySelector<HTMLElement>('[data-settings-group="provider-runs-with"]')!;
    expect(visibleText(section)).toContain("Roule avec");
    expect(visibleText(section)).toContain("Ce qui fait rouler tes bots quand ils utilisent OpenAI.");
    expect(section.querySelector("button[data-pill-select]")!.textContent).toBe("pi");
  });

  it("is absent where one engine only can run the provider", async () => {
    fixture.instances = [openaiKey()];
    await page("openai");
    expect(host.querySelector('[data-settings-group="provider-runs-with"]')).toBeNull();
  });
});
