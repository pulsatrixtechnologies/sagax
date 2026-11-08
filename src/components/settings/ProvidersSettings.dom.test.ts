// @vitest-environment happy-dom
// Settings > Providers after #2080 (the owner 2026-11-05): one row per provider,
// its accounts inside; no filters, no organization band, no row the
// organization manages in Perspicax, nothing turned off or waiting to be
// connected (Add a provider, last row, covers it). Who pays and the models
// count behind each row, Other services and the Advanced fold.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InstanceInfo } from "@/state/store";
import type { MyEngine } from "@/lib/perspicax-org";
import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = vi.hoisted(() => ({
  org: null as null | { org: { name: string; identity: { kind: "perspicax"; issuer: string } } },
  mine: null as null | MyEngine[],
  config: {} as Record<string, unknown>,
  instances: [] as InstanceInfo[],
  dispatch: vi.fn(),
}));

const answers = (path: string): unknown => {
  if (path === "/api/me/providers") return { keys: [], servers: [] };
  if (path === "/api/me/local-models") return { expose: false, share: false, endpoints: [] };
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
  loadLocalModels: vi.fn(async () => ({ expose: false, share: false, endpoints: [] })),
}));
vi.mock("../DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("../HarnessConnectorsSection", () => ({ HarnessConnectorsSection: () => createElement("div", { "data-harness-connectors": "" }) }));

const { ProvidersSettings, providerAction, providerLine } = await import("./ProvidersSettings");

let host: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => { root.render(createElement(ProvidersSettings)); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  return host;
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

beforeEach(() => {
  setLocale("en");
  fixture.org = null;
  fixture.mine = null;
  fixture.config = { viewer: { operator: true, role: "admin" } };
  fixture.instances = [];
  fixture.dispatch = vi.fn();
  if (!("checkVisibility" in Element.prototype)) Object.defineProperty(Element.prototype, "checkVisibility", { configurable: true, value: () => true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("providerAction: one action per row", () => {
  it("opens Perspicax for a row the organization manages, else follows the row's state", () => {
    expect(providerAction({ state: "connected", kind: "key" }, true)).toBe("open");
    expect(providerAction({ state: "keyMissing", kind: "key" }, false)).toBe("enterKey");
    expect(providerAction({ state: "reconnect", kind: "account" }, false)).toBe("reconnect");
    expect(providerAction({ state: "offline", kind: "local" }, false)).toBe("start");
    expect(providerAction({ state: "connected", kind: "account" }, false)).toBe("manage");
  });
});

describe("providerLine: who pays, never where the key lives", () => {
  it("names the payer and what the row brings, never Signed-in session", () => {
    const line = providerLine({
      id: "account:claude", kind: "account", name: "alex_admin@example.com", payer: "me",
      keyWhere: "session", state: "connected", instanceIds: ["claude"], brings: [], manage: true,
    }, () => "Claude");
    expect(line.startsWith("Me")).toBe(true);
    expect(line.toLowerCase()).not.toContain("signed");
    expect(line.toLowerCase()).not.toContain("session");
  });
});

describe("Settings > Providers, solo", () => {
  it("draws the list, Other services (web search, image generation) and the Advanced fold, no organization band", async () => {
    fixture.instances = [instance("mistral", "mistral", "Mistral")];
    await render();
    // #2080 (L0): the page header draws the intro, not the page
    expect(host.querySelector("[data-settings-intro]")).toBeNull();
    expect(host.querySelector("[data-providers-org-band]")).toBeNull();
    expect(host.querySelector('[data-settings-card="providers.list"]')).not.toBeNull();
    const services = host.querySelector('[data-settings-card="providers.services"]')!;
    expect(services.textContent).toContain("Web search");
    expect(services.querySelector('[data-settings-card="connections.image"]'), "image generation editable in solo").not.toBeNull();
    expect(services.querySelector('[data-perspicax-link="imageGen"]')).toBeNull();
    expect(host.querySelector('[data-settings-card="providers.advanced"]')).not.toBeNull();
    // the row's state and its one action
    const row = host.querySelector<HTMLElement>('[data-provider-row="key:me:server:mistral"]')!;
    expect(row).not.toBeNull();
    expect(row.querySelector("[data-provider-state]")?.getAttribute("data-provider-state")).toBe("connected");
    expect(row.querySelector("[data-provider-action]"), "connected: the whole row opens, a chevron").toBeNull();
    expect(row.querySelector("[data-provider-open-perspicax]")).toBeNull();
    // no filter chips; Add a provider is the card's one primary action, last row
    expect(host.querySelector("[data-provider-filter]")).toBeNull();
    const addRow = host.querySelector<HTMLElement>('[data-settings-card="providers.list"] [data-add-provider-row]');
    const add = addRow?.querySelector<HTMLElement>("[data-add-provider-open]");
    expect(add).not.toBeNull();
    expect(add!.className).toContain("ui-button-primary");
    // this computer's model servers are one provider of their own; Add follows them
    const local = host.querySelector('[data-provider-group="local"]')!;
    expect(local.textContent).toContain("Off");
    expect(local.compareDocumentPosition(addRow!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows who pays on the grey line, never Signed-in session, and one action (chevron) when connected", async () => {
    fixture.instances = [instance("claude", "claudeAgent", "Claude", { access: "subscription" })];
    await render();
    const row = host.querySelector<HTMLElement>('[data-provider-row="account:claude"]')!;
    expect(row).not.toBeNull();
    // The grey line's title carries who pays · what it brings (state is a sibling).
    const grey = row.querySelector("button[aria-expanded] [title]")?.getAttribute("title") ?? "";
    expect(grey).toContain("Me");
    expect(grey.toLowerCase()).not.toContain("signed");
    expect(grey.toLowerCase()).not.toContain("session");
    expect(row.querySelector("[data-provider-action]")).toBeNull();
    expect(row.querySelectorAll(":scope > button")).toHaveLength(1);
  });

  it("groups several accounts of one provider in one row: N accounts, their state, each account inside", async () => {
    fixture.instances = [
      instance("claude", "claudeAgent", "Claude", { access: "subscription" }),
      instance("claude-work", "claudeAgent", "Claude work", { access: "subscription" }),
    ];
    await render();
    const groups = host.querySelectorAll<HTMLElement>("[data-provider-group]:not([data-provider-group='local'])");
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.textContent).toContain("Claude");
    expect(group.textContent).toContain("2 accounts");
    expect(group.querySelector("[data-provider-group-state]")?.getAttribute("data-provider-group-state")).toBe("connected");
    expect(group.querySelectorAll(":scope > button")).toHaveLength(1);
    expect(group.querySelector("[data-provider-group-rows]")).toBeNull();
    await act(async () => { group.querySelector<HTMLButtonElement>(":scope > button")!.click(); });
    expect(group.querySelectorAll("[data-provider-group-rows] > [data-provider-row]")).toHaveLength(2);
  });

  it("opens a row on Who pays (editable in solo), the active models link to Models, and the Advanced fold with the id", async () => {
    fixture.instances = [instance("mistral", "mistral", "Mistral")];
    await render();
    const row = host.querySelector<HTMLElement>('[data-provider-row="key:me:server:mistral"]')!;
    await act(async () => { row.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click(); });
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
    expect(row.querySelector('[data-settings-row="providers.whoPays.key:me:server:mistral"]')).not.toBeNull();
    expect(row.querySelector('[data-provider-who-pays="perspicax"]')).toBeNull();
    const models = row.querySelector<HTMLButtonElement>('[data-link-row="providers.models.key:me:server:mistral"]')!;
    expect(models.textContent).toContain("2 of 2 models active");
    act(() => models.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "engines" });
    // no GUID outside the fold: the id sits inside the Advanced fold
    expect(row.querySelector("[data-engine-advanced], [data-provider-advanced]")).not.toBeNull();
  });
});

describe("Settings > Providers, this computer's model servers (from Settings > Computer, #2080 L1/L3)", () => {
  it("opens the local group on the full Local models settings, which no longer live on the Computer page", async () => {
    await render();
    const local = host.querySelector<HTMLElement>('[data-provider-group="local"]')!;
    expect(local.textContent).toContain("Local models");
    expect(local.querySelector("[data-local-models]"), "closed: settings stay folded").toBeNull();
    await act(async () => { local.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click(); });
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
    const settings = local.querySelector<HTMLElement>('[data-settings-card="providers.localModels"]')!;
    expect(settings, "LocalModelsSettings, bare, inside Providers").not.toBeNull();
    expect(settings.dataset.localModels).toBe("off");
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

  it("hides the organization band and the rows the organization pays for (they still apply, out of sight)", async () => {
    await render();
    expect(host.querySelector("[data-providers-org-band]")).toBeNull();
    expect(host.querySelector("[data-org-band]")).toBeNull();
    expect(host.querySelector('[data-provider-row="key:org:server:mistral"]')).toBeNull();
    expect(host.querySelector('[data-provider-state="managed"]')).toBeNull();
    // no shortcut to Perspicax (2026-11-05)
    expect(host.querySelector('a[href*="/console/settings"]')).toBeNull();
    expect(host.querySelector("[data-view-as-member]"), "no View as a member").toBeNull();
  });

  it("keeps the person's own subscription row with its own action, and image generation read-only", async () => {
    await render();
    const codex = host.querySelector<HTMLElement>('[data-provider-row="account:codex"]')!;
    expect(codex).not.toBeNull();
    expect(codex.querySelector('[data-provider-state="managed"]')).toBeNull();
    const services = host.querySelector('[data-settings-card="providers.services"]')!;
    expect(services.querySelector('[data-settings-card="connections.image"]')).toBeNull();
    expect(services.querySelector('[data-settings-row="providers.imageGen"]')).not.toBeNull();
    expect(services.querySelector('[data-perspicax-link="imageGen"]')).toBeNull();
  });
});
