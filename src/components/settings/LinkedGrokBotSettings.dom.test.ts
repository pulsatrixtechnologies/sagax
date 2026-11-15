// @vitest-environment happy-dom
// #4329 lot 2: the bots link is the line "Your bots there" in the xAI
// provider's row of Settings > Providers and a block on that provider's page
// (never a screen of its own under Advanced): Connect asks the address and
// the key once, Disconnect pauses and keeps the key, its state is said once,
// and the first level shows no address, key, header name, dead letters or
// circuit.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InstanceInfo } from "@/state/store";
import type { GrokBridgeLinkView } from "@/lib/grok-bridge";
import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = vi.hoisted(() => ({
  instances: [] as InstanceInfo[],
  link: null as null | GrokBridgeLinkView,
  puts: [] as unknown[],
  dispatch: vi.fn(),
}));

const answers = (path: string, init?: { method?: string; body?: string }): unknown => {
  if (path === "/api/me/providers") return { keys: [], servers: [] };
  if (path === "/api/me/local-models") return { expose: false, share: false, connected: false, endpoints: [], published: [], probes: [] };
  if (path === "/api/me/pi-model-servers") return { servers: [] };
  if (path === "/api/me/grok-bridge") {
    if (!fixture.link) throw new Error("not found");
    if (init?.method === "PUT") {
      const body = JSON.parse(init.body ?? "{}") as Partial<GrokBridgeLinkView> & { key?: string; webhookUrl?: string };
      fixture.puts.push(body);
      const { key, ...rest } = body;
      fixture.link = { ...fixture.link, ...rest, linked: Boolean(rest.webhookUrl ?? fixture.link.webhookUrl), keySet: fixture.link.keySet || Boolean(key) };
    }
    return fixture.link;
  }
  throw new Error(`no answer for ${path}`);
};

vi.mock("@/state/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/state/store")>();
  const state = () => ({ instances: fixture.instances, bots: [], groups: [], config: { viewer: { operator: true, role: "admin" } } });
  return {
    ...actual,
    api: vi.fn(async (path: string, init?: { method?: string; body?: string }) => answers(path, init)),
    useStore: () => ({ state: state(), dispatch: fixture.dispatch, refreshInstances: vi.fn(), refreshModels: vi.fn() }),
    useStoreOptional: () => ({ state: state(), dispatch: fixture.dispatch }),
  };
});
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/perspicax-org")>(),
  usePerspicaxOrg: () => null,
  useMyEngines: () => null,
}));
vi.mock("../DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("../HarnessConnectorsSection", () => ({ HarnessConnectorsSection: () => createElement("div", { "data-harness-connectors": "" }) }));

const { ProvidersSettings } = await import("./ProvidersSettings");
const { ProviderPage } = await import("./ProviderPage");
const { providerPageId } = await import("./provider-page-id");
const { requestSettingsCard, resetSettingsCards } = await import("../SettingsPrimitives");

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
const page = () => render(createElement(ProviderPage, { providerId: "xai" }));
async function rerender(element?: Parameters<Root["render"]>[0]) {
  act(() => root.unmount());
  root = createRoot(host);
  return render(element);
}
const openedXaiPage = () => fixture.dispatch.mock.calls.some(([action]) => (action as { subPage?: string }).subPage === providerPageId("xai"));
const count = (text: string, part: string) => text.split(part).length - 1;
async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => { (element as HTMLElement).click(); });
  await settle();
}
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

const grok = (over: Partial<InstanceInfo> = {}): InstanceInfo => ({
  instanceId: "grok", driverKind: "grok", displayName: "Grok", access: "subscription", cliDefault: "grok",
  snapshot: { state: "available", authenticated: true, account: { email: "ada@example.com" } },
  models: { default: "grok-4", options: [{ id: "grok-4", label: "Grok 4" }] },
  ...over,
} as InstanceInfo);

const linked: GrokBridgeLinkView = {
  linked: true, enabled: true, webhookUrl: "https://bots.example/hook", keySet: true, linkId: "link_abc", bots: [],
  mayCallOwner: false, mayTextOwner: false, orgAllowed: true,
  stats: { sentToday: 3, receivedToday: 0, deadLetters: 1, circuitOpen: false },
};
const unlinked: GrokBridgeLinkView = { linked: false, enabled: false, keySet: false, bots: [], mayCallOwner: false, mayTextOwner: false, orgAllowed: true };

/** What shows without opening any Advanced fold. */
function visibleText(scope: Element): string {
  const clone = scope.cloneNode(true) as Element;
  for (const node of clone.querySelectorAll("[hidden], [data-bots-link-advanced]")) node.remove();
  return clone.innerHTML;
}

beforeEach(() => {
  setLocale("en");
  resetSettingsCards();
  fixture.dispatch = vi.fn();
  fixture.instances = [];
  fixture.link = null;
  fixture.puts = [];
  if (!("checkVisibility" in Element.prototype)) Object.defineProperty(Element.prototype, "checkVisibility", { configurable: true, value: () => true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Settings > Providers: the bots link is part of the xAI provider's one row (#4376)", () => {
  it("says it in the xAI provider's one line, never a second line, never in Providers > Advanced", async () => {
    fixture.instances = [grok()];
    fixture.link = linked;
    await render();
    const row = host.querySelector('[data-settings-card="providers.list"] [data-provider="xai"]')!;
    expect(row, "the xAI provider's row").not.toBeNull();
    expect(row.textContent).toContain("SpaceXSI");
    expect(row.querySelector("[data-provider-summary]")!.textContent).toBe("Connected · your bots there too");
    expect(row.getAttribute("data-settings-row"), "a search finds the link on that row").toBe("providers.botsLink");
    expect(host.querySelectorAll("[data-bots-link-row]")).toHaveLength(1);
    expect(host.querySelector("[data-providers-advanced] [data-bots-link-row], [data-providers-advanced] [data-bots-link-block]")).toBeNull();
  });

  it("no Disconnect or Connect on a connected provider's row: they are on its page", async () => {
    fixture.instances = [grok()];
    fixture.link = linked;
    await render();
    expect(host.querySelector('[data-provider="xai"] [data-bots-link-action], [data-provider="xai"] [data-provider-action]')).toBeNull();
    await click(host.querySelector('[data-provider="xai"] [data-provider-open]'));
    expect(openedXaiPage()).toBe(true);
    fixture.link = { ...linked, enabled: false };
    await rerender();
    expect(host.querySelector('[data-provider="xai"] [data-provider-summary]')!.textContent, "a paused link: the provider is still connected").toBe("Connected");
  });

  it("not linked, with an xAI account: the row opens the xAI provider's page, where Connect is", async () => {
    fixture.instances = [grok()];
    fixture.link = unlinked;
    await render();
    expect(host.querySelector('[data-provider="xai"] [data-bots-link-action]')).toBeNull();
    await click(host.querySelector('[data-provider="xai"] [data-provider-open]'));
    expect(fixture.puts).toEqual([]);
    expect(openedXaiPage()).toBe(true);
  });

  it("no xAI account, not linked, the organization allows it: the xAI provider's own row offers Connect", async () => {
    fixture.link = unlinked;
    await render();
    const row = host.querySelector('[data-settings-card="providers.list"] [data-provider="xai"]');
    expect(row, "the xAI provider's own row").not.toBeNull();
    expect(row!.textContent).toContain("SpaceXSI");
    expect(row!.textContent).toContain("Your bots there");
    await click(row!.querySelector('[data-bots-link-action="connect"]'));
    expect(fixture.puts).toEqual([]);
    expect(openedXaiPage(), "Connect opens the xAI page and its Connect step").toBe(true);
  });

  it("an old link to the bots link opens the xAI page with no xAI account and no link yet", async () => {
    fixture.link = unlinked;
    requestSettingsCard("providers.linkedGrokBot");
    await render();
    expect(openedXaiPage()).toBe(true);
  });

  it("no xAI account listed: the xAI provider's own row when linked", async () => {
    fixture.link = linked;
    await render();
    const row = host.querySelector('[data-settings-card="providers.list"] [data-provider="xai"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain("SpaceXSI");
    expect(row!.textContent).toContain("Your bots there");
  });

  it("organization off: the xAI row stays connected with no button, and the link's row is gone without a link", async () => {
    fixture.instances = [grok()];
    fixture.link = { ...linked, orgAllowed: false };
    await render();
    expect(host.querySelector('[data-provider="xai"] [data-provider-summary]')!.textContent).toBe("Connected");
    expect(host.querySelector("[data-bots-link-row] [data-bots-link-action]")).toBeNull();
    fixture.instances = [];
    await rerender();
    expect(host.querySelector('[data-provider="xai"] [data-provider-summary]')!.textContent).toBe("Your bots there · Turned off by your organization");
    fixture.link = { ...unlinked, orgAllowed: false };
    await rerender();
    expect(host.querySelector("[data-bots-link-row]")).toBeNull();
  });

  it("an old link to the bots link opens the xAI provider's page", async () => {
    fixture.instances = [grok()];
    fixture.link = linked;
    requestSettingsCard("providers.linkedGrokBot");
    await render();
    expect(openedXaiPage()).toBe(true);
  });
});

describe("the xAI provider's page: the bots link block", () => {
  it("first level: the sentence, the state once with its button, two switches, no technical field", async () => {
    fixture.instances = [grok()];
    fixture.link = { ...linked, stats: { sentToday: 3, receivedToday: 0, deadLetters: 2, circuitOpen: true } };
    await page();
    const block = host.querySelector('[data-provider-page="xai"] [data-settings-card="providers.linkedGrokBot"] [data-bots-link-block]')!;
    expect(block).not.toBeNull();
    const shown = visibleText(block);
    expect(shown).toContain("Those bots may call me");
    expect(shown).toContain("Those bots may text me");
    expect(block.querySelectorAll("[data-bots-link-action]")).toHaveLength(1);
    expect(count(block.textContent ?? "", "Connected")).toBe(1);
    expect(shown).not.toContain("https://bots.example/hook");
    expect(shown).not.toContain("/api/bridge/grok/");
    expect(shown).not.toMatch(/x-bridge-signature|dead letter|circuit|webhook|hmac/i);
    expect(shown).not.toContain('type="password"');
  });

  it("organization off: the state is said once, the link kept, no switch and no button", async () => {
    fixture.instances = [grok()];
    fixture.link = { ...linked, orgAllowed: false };
    await page();
    const block = host.querySelector("[data-bots-link-block]")!;
    expect(count(visibleText(block), "Turned off by your organization")).toBe(1);
    expect(visibleText(block)).toContain("Your address and key are kept.");
    expect(block.querySelector("[data-bots-link-action]")).toBeNull();
    expect(block.querySelector('[data-settings-row="grokBridgeMayCall"]')).toBeNull();
  });

  it("not linked: Connect asks the address and the key; an address alone never connects", async () => {
    fixture.instances = [grok()];
    fixture.link = unlinked;
    await page();
    const step = host.querySelector("[data-bots-link-connect]")!;
    expect(step).not.toBeNull();
    const submit = step.querySelector<HTMLButtonElement>("[data-bots-link-connect-submit]")!;
    type(step.querySelector<HTMLInputElement>('[data-settings-row="grokBridgeAddress"] input')!, "https://bots.example/hook");
    await settle();
    expect(submit.disabled, "no key: Connect stays off").toBe(true);
    await click(submit);
    expect(fixture.puts).toEqual([]);
    type(step.querySelector<HTMLInputElement>('[data-settings-row="grokBridgeConnectKey"] input')!, "k-123");
    await settle();
    expect(submit.disabled).toBe(false);
    await click(submit);
    expect(fixture.puts).toEqual([{ webhookUrl: "https://bots.example/hook", key: "k-123", enabled: true }]);
    expect(host.querySelector("[data-bots-link-connect]")).toBeNull();
    expect(host.querySelector('[data-bots-link-block] [data-bots-link-action="disconnect"]')).not.toBeNull();
  });

  it("no xAI account: the page still holds the linked bots link", async () => {
    fixture.link = linked;
    await page();
    expect(host.querySelector('[data-provider-page="xai"] [data-bots-link-block]')).not.toBeNull();
    expect(host.querySelector('[data-provider-page="xai"] [data-provider-page-advanced] [data-settings-card="providers.linkedGrokBot.advanced"]')).not.toBeNull();
  });

  it("no xAI account, not linked, the organization allows it: the page shows the Connect step", async () => {
    fixture.link = unlinked;
    await page();
    expect(host.textContent).not.toContain("not connected any more");
    const step = host.querySelector('[data-provider-page="xai"] [data-bots-link-connect]');
    expect(step, "Connect is reachable").not.toBeNull();
    expect(step!.querySelector("[data-bots-link-connect-submit]")).not.toBeNull();
  });

  it("no xAI account, not linked, the organization turned it off: nothing to connect, the page is gone", async () => {
    fixture.link = { ...unlinked, orgAllowed: false };
    await page();
    expect(host.querySelector("[data-bots-link-block]")).toBeNull();
  });

  it("one Advanced on the page: the link's technical fields are its titled part of it", async () => {
    fixture.instances = [grok()];
    fixture.link = linked;
    await page();
    const xai = host.querySelector('[data-provider-page="xai"]')!;
    const labels = [...xai.querySelectorAll("*")].filter((node) => node.children.length === 0 && node.textContent?.trim() === "Advanced");
    expect(labels, "one fold named Advanced").toHaveLength(1);
    expect(xai.querySelector("[data-bots-link-block] [data-bots-link-advanced]"), "no fold inside the block").toBeNull();
    const part = xai.querySelector('[data-provider-page-advanced] [data-settings-card="providers.linkedGrokBot.advanced"]');
    expect(part, "inside the page's Advanced").not.toBeNull();
    expect(part!.textContent).toContain("Your bots there");
    expect(part!.querySelector('[data-settings-row="grokBridgeWebhook"]')).not.toBeNull();
  });

  it("an old link to the link's Advanced opens the page's Advanced on it", async () => {
    fixture.instances = [grok()];
    fixture.link = linked;
    requestSettingsCard("providers.linkedGrokBot.advanced");
    await page();
    const fold = host.querySelector('[data-provider-page="xai"] [data-provider-page-advanced]')!;
    expect(fold.hasAttribute("hidden")).toBe(false);
  });
});
