// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { HarnessConnectorsAnswer } from "./HarnessConnectorsSection";
import type { MyEngine } from "@/lib/perspicax-org";

const opened: string[] = [];
vi.mock("@/lib/app-links", () => ({ openExternalLink: vi.fn(async (url: string) => { opened.push(url); }) }));

let answer: HarnessConnectorsAnswer;
vi.mock("@/state/store", () => ({ api: vi.fn(async () => answer), useStore: () => ({ refreshInstances: async () => {}, refreshModels: async () => {} }) }));
let engines: MyEngine[] | null = null;
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({ ...(await importOriginal<object>()), useMyEngines: () => engines, reloadMyEngines: async () => null }));

const { HarnessConnectorsSection } = await import("./HarnessConnectorsSection");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MANAGE = "https://claude.ai/customize/connectors";
const base = (connectors: HarnessConnectorsAnswer["claude"]["connectors"], providers?: HarnessConnectorsAnswer["providers"]): HarnessConnectorsAnswer => ({
  manageUrl: MANAGE,
  canManage: true,
  enabled: true,
  claude: { available: true, connectors },
  codex: { available: true },
  ...(providers ? { providers } : {}),
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  opened.length = 0;
  engines = null;
  setLocale("en");
});

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(HarnessConnectorsSection, {})); });
  await act(async () => { await Promise.resolve(); });
  return host;
}

describe("HarnessConnectorsSection — connect-from-engine on not-connected rows", () => {
  it("a sign-in-required connector gets a one-click link to the engine page", async () => {
    answer = base([{ name: "Microsoft 365", status: "needs_auth" }]);
    const host = await mount();
    const open = host.querySelectorAll("[data-connect-from-engine-open]");
    expect(open).toHaveLength(1);
    act(() => { open[0]!.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
    expect(opened).toEqual([MANAGE]);
  });

  it("a failed connector gets the link too", async () => {
    answer = base([{ name: "Gmail", status: "failed" }]);
    const host = await mount();
    expect(host.querySelectorAll("[data-connect-from-engine-open]")).toHaveLength(1);
  });

  it("a connected connector shows no connect link (no fake state)", async () => {
    answer = base([{ name: "Microsoft 365", status: "connected" }]);
    const host = await mount();
    expect(host.querySelector("[data-connect-from-engine]")).toBeNull();
  });

  it("the link is never injected into a chat: it lives in the connectors list only", async () => {
    answer = base([{ name: "Microsoft 365", status: "needs_auth" }]);
    const host = await mount();
    // the affordance sits inside the connectors section, not a standalone widget
    expect(host.querySelector("[data-harness-connectors] [data-connect-from-engine-open]")).not.toBeNull();
  });
});

describe("#4408: Providers > Advanced draws a section per provider whose account carries connectors", () => {
  it("one section each for Claude, OpenAI and SpaceXSI, the same way, with its count and its own place to manage them", async () => {
    answer = base([], [
      { provider: "claude-ai", vendor: "anthropic", manageUrl: MANAGE, available: true, connectors: [{ name: "Gmail", status: "connected" }, { name: "Notion", status: "needs_auth" }] },
      { provider: "chatgpt-apps", vendor: "openai", manageUrl: "https://chatgpt.com/#settings/Connectors", available: true, connectors: [{ name: "Notes", status: "connected" }] },
      { provider: "grok-com", vendor: "xai", manageUrl: "https://grok.com/connectors", available: true, connectors: [{ id: "outlook", name: "Outlook", status: "connected" }] },
      // signed in, no connector: no section
    ]);
    const host = await mount();
    const sections = [...host.querySelectorAll("[data-account-connectors]")];
    expect(sections.map((section) => section.getAttribute("data-account-connectors"))).toEqual(["claude-ai", "chatgpt-apps", "grok-com"]);
    expect(host.textContent).toContain("Provided by Claude (your account)");
    expect(host.textContent).toContain("Provided by OpenAI (your account)");
    expect(host.textContent).toContain("Provided by SpaceXSI (your account)");
    expect(host.textContent).toContain("2 connectors");
    const manage = [...host.querySelectorAll("[data-harness-connectors-manage]")].map((button) => button.textContent);
    expect(manage).toEqual(["Manage on claude.ai", "Manage on chatgpt.com", "Manage on grok.com"]);
    act(() => { host.querySelector("[data-harness-connectors-manage=grok-com]")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
    expect(opened).toEqual(["https://grok.com/connectors"]);
  });

  it("a provider never signed in shows its one first step, its engine's own Connect; an expired one draws nothing (its row says so)", async () => {
    const mine = (instanceId: string, driver: string, over: Partial<MyEngine["subscription"]> = {}): MyEngine => ({
      instanceId, driver, displayName: instanceId, installed: true, subscription: { supported: true, signedIn: false, ...over }, myKey: false, orgKey: false, myTurns: "none",
    });
    engines = [mine("claude", "claudeAgent", { signedIn: true, expired: true }), mine("codex", "codex")];
    answer = base([], [
      { provider: "claude-ai", vendor: "anthropic", manageUrl: MANAGE, available: false, reason: "not_signed_in", connectors: [] },
      { provider: "chatgpt-apps", vendor: "openai", manageUrl: "https://chatgpt.com/#settings/Connectors", available: false, reason: "not_signed_in", connectors: [] },
    ]);
    const host = await mount();
    expect([...host.querySelectorAll("[data-account-connectors]")].map((section) => section.getAttribute("data-account-connectors"))).toEqual(["chatgpt-apps"]);
    const section = host.querySelector("[data-account-connectors=chatgpt-apps]")!;
    expect(section.textContent).toContain("Provided by OpenAI (your account)");
    expect(section.textContent).toContain("You are not signed in to OpenAI");
    expect(section.querySelector("[data-engine-connect=codex] [data-engine-connect-button]")).not.toBeNull();
    // neither Check again nor Manage helps before a sign-in
    expect(section.querySelector("[data-harness-connectors-manage]")).toBeNull();
    expect(section.querySelector("button[aria-label='Check again']")).toBeNull();
  });

  it("a provider with no account connectors draws nothing", async () => {
    answer = base([], [
      { provider: "claude-ai", vendor: "anthropic", manageUrl: MANAGE, available: true, connectors: [] },
      { provider: "chatgpt-apps", vendor: "openai", manageUrl: "https://chatgpt.com/#settings/Connectors", available: false, reason: "key", connectors: [] },
    ]);
    const host = await mount();
    expect(host.querySelector("[data-account-connectors]")).toBeNull();
  });
});
