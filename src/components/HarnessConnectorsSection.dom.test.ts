// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { HarnessConnectorsAnswer } from "./HarnessConnectorsSection";

const opened: string[] = [];
vi.mock("@/lib/app-links", () => ({ openExternalLink: vi.fn(async (url: string) => { opened.push(url); }) }));

let answer: HarnessConnectorsAnswer;
vi.mock("@/state/store", () => ({ api: vi.fn(async () => answer) }));

const { HarnessConnectorsSection } = await import("./HarnessConnectorsSection");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MANAGE = "https://claude.ai/customize/connectors";
const base = (connectors: HarnessConnectorsAnswer["claude"]["connectors"]): HarnessConnectorsAnswer => ({
  manageUrl: MANAGE,
  canManage: true,
  enabled: true,
  claude: { available: true, connectors },
  codex: { available: true },
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  opened.length = 0;
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
