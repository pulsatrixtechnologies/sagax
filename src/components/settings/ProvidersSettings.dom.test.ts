// @vitest-environment happy-dom
// Settings > Providers after the 2026-11-05 redesign (option B, #2050): one
// list, one action per row, the organization band and the rows an
// organization manages in Perspicax (no key form, Open link), Who pays and
// the models count behind each row, Other services and the Advanced fold.
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
vi.mock("../DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("../HarnessConnectorsSection", () => ({ HarnessConnectorsSection: () => createElement("div", { "data-harness-connectors": "" }) }));

const { ProvidersSettings, providerAction } = await import("./ProvidersSettings");

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
    expect(row.querySelector("[data-provider-action]")?.getAttribute("data-provider-action")).toBe("manage");
    expect(row.querySelector("[data-provider-open-perspicax]")).toBeNull();
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

  it("shows the organization band with the Perspicax link and the same-page note, for admins too", async () => {
    await render();
    const band = host.querySelector<HTMLElement>("[data-providers-org-band]")!;
    expect(band.textContent).toContain("Example");
    expect(band.querySelector<HTMLAnchorElement>("[data-providers-org-console]")?.href).toBe("https://px.example.test/console/settings/org.bots?tab=policies");
    expect(band.querySelector("[data-providers-same-page]")).not.toBeNull();
    expect(host.querySelector("[data-view-as-member]"), "no View as a member").toBeNull();
  });

  it("marks a provider the organization pays for as Managed in Perspicax: Open link, no key form, Who pays read-only", async () => {
    await render();
    const row = host.querySelector<HTMLElement>('[data-provider-row="key:org:server:mistral"]')!;
    expect(row, "the organization's key row").not.toBeNull();
    expect(row.querySelector('[data-provider-state="managed"]')?.textContent).toBe("Managed in Perspicax");
    expect(row.querySelector("[data-provider-action]")?.getAttribute("data-provider-action")).toBe("open");
    expect(row.querySelector<HTMLAnchorElement>("[data-provider-open-perspicax]")?.href).toContain("/console/settings/org.bots?tab=policies");
    await act(async () => { row.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click(); });
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
    expect(row.querySelector("[data-provider-who-pays='perspicax']")?.textContent).toContain("Chosen in Perspicax");
    expect(row.querySelector("[data-open-provider-key]")).toBeNull();
  });

  it("keeps the person's own subscription row with its own action, and image generation read-only with Set in Perspicax", async () => {
    await render();
    const codex = host.querySelector<HTMLElement>('[data-provider-row="account:codex"]')!;
    expect(codex).not.toBeNull();
    expect(codex.querySelector('[data-provider-state="managed"]')).toBeNull();
    const services = host.querySelector('[data-settings-card="providers.services"]')!;
    expect(services.querySelector('[data-settings-card="connections.image"]')).toBeNull();
    expect(services.querySelector<HTMLAnchorElement>('[data-perspicax-link="imageGen"]')?.href).toBe("https://px.example.test/console/");
  });
});
