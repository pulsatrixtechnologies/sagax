// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { CLAUDE_AI_CONNECTORS_URL } from "../../shared/connector-setup";

const opened: string[] = [];
vi.mock("@/lib/app-links", () => ({ openExternalLink: vi.fn(async (url: string) => { opened.push(url); }) }));

const { ConnectFromEngine } = await import("./ConnectFromEngine");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  opened.length = 0;
  setLocale("en");
});

type Props = Parameters<typeof ConnectFromEngine>[0];
function mount(props: Props) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(ConnectFromEngine, props)));
  return host;
}
function click(el: Element | null) {
  act(() => { el?.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
}

describe("ConnectFromEngine", () => {
  it("renders nothing when the capability is not missing (no fake state)", () => {
    const host = mount({ missing: false, manageUrl: CLAUDE_AI_CONNECTORS_URL, name: "Microsoft Teams" });
    expect(host.querySelector("[data-connect-from-engine]")).toBeNull();
  });

  it("missing: one button that opens the EXISTING engine connector path, not a new flow", () => {
    const host = mount({ missing: true, manageUrl: CLAUDE_AI_CONNECTORS_URL, name: "Microsoft Teams" });
    const open = host.querySelectorAll("[data-connect-from-engine-open]");
    expect(open).toHaveLength(1);
    click(open[0]!);
    // the one click goes to the engine's own connector page, unchanged
    expect(opened).toEqual([CLAUDE_AI_CONNECTORS_URL]);
    expect(CLAUDE_AI_CONNECTORS_URL).toBe("https://claude.ai/customize/connectors");
  });

  it("fails closed: never points anywhere but claude.ai or grok.com", () => {
    const host = mount({ missing: true, manageUrl: "https://evil.example/oauth/start", name: "Microsoft Teams" });
    expect(host.querySelector("[data-connect-from-engine]")).toBeNull();
  });

  it("is dismissible when asked, and hides on dismiss", () => {
    const host = mount({ missing: true, manageUrl: CLAUDE_AI_CONNECTORS_URL, name: "Microsoft Teams", dismissible: true });
    const dismiss = host.querySelector("[data-connect-from-engine-dismiss]");
    expect(dismiss).not.toBeNull();
    click(dismiss);
    expect(host.querySelector("[data-connect-from-engine]")).toBeNull();
  });

  it("no dismiss control unless asked (persistent fix-it link in a list)", () => {
    const host = mount({ missing: true, manageUrl: CLAUDE_AI_CONNECTORS_URL, name: "Microsoft Teams" });
    expect(host.querySelector("[data-connect-from-engine-dismiss]")).toBeNull();
  });

  it("shows a human label and no id or secret", () => {
    setLocale("fr");
    const host = mount({ missing: true, manageUrl: CLAUDE_AI_CONNECTORS_URL, name: "Microsoft Teams", dismissible: true });
    const text = (host.textContent ?? "");
    expect(text).toContain("Microsoft Teams");
    expect(text).toContain("claude.ai");
    expect(text).not.toContain("cs_");
    expect(host.innerHTML).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });
});
