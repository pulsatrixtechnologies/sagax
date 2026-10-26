// @vitest-environment happy-dom
// A live app (message kind "app") is drawn in the same locked sandbox as a
// ```widget: allow-scripts only, an opaque origin, and a CSP that forbids
// every network request. A live update (a new revision) replaces the page in
// place. The renderer never widens that sandbox.
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { Message } from "@/state/store";
import { AppMessage } from "./AppMessage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("style");
});

function mount(message: Partial<Message> & { id: string }) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(AppMessage, { message: { role: "bot", kind: "app", at: 1, ...message } as Message })));
  return host;
}

function rerender(host: HTMLElement, message: Partial<Message> & { id: string }) {
  act(() => root!.render(createElement(AppMessage, { message: { role: "bot", kind: "app", at: 1, ...message } as Message })));
  return host;
}

const appRow = (id: string, html: string, extra: Record<string, unknown> = {}): Partial<Message> & { id: string } =>
  ({ id, text: "[app]", app: { v: 1, html, ...extra } } as Partial<Message> & { id: string });

describe("AppMessage", () => {
  it("renders the page in an allow-scripts-only sandbox with no network", () => {
    const host = mount(appRow("abc-123", "<h1>Rapport</h1>", { title: "Rapport" }));
    const iframe = host.querySelector("iframe")!;
    // allow-scripts ONLY: an opaque origin, no privileged same-origin access,
    // no forms, popups, top navigation or downloads
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
    const srcdoc = iframe.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("<h1>Rapport</h1>");
    // the CSP comes before any app byte and forbids every network request
    expect(srcdoc).toContain("Content-Security-Policy");
    expect(srcdoc).toContain("default-src 'none'");
    expect(srcdoc).toContain("connect-src 'none'");
    expect(srcdoc).toContain("frame-src 'none'");
  });

  it("shows the bot's human title and never the raw message id", () => {
    const host = mount(appRow("secret-uuid-should-not-show", "<p>x</p>", { title: "Tableau de bord" }));
    expect(host.textContent).toContain("Tableau de bord");
    expect(host.textContent).not.toContain("secret-uuid-should-not-show");
  });

  it("replaces the page in place on a live update (a new revision)", () => {
    const host = mount(appRow("abc-123", "<p>0%</p>"));
    expect(host.querySelector("iframe")!.getAttribute("srcdoc")).toContain("<p>0%</p>");
    rerender(host, appRow("abc-123", "<p>100%</p>", { rev: 1 }));
    const srcdoc = host.querySelector("iframe")!.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("<p>100%</p>");
    expect(srcdoc).not.toContain("<p>0%</p>");
    // one surface only, not a second frame appended
    expect(host.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("falls back to its text when the page is empty or missing", () => {
    expect(mount({ id: "e1", text: "[app] nothing", app: { v: 1, html: "" } } as Partial<Message> & { id: string }).querySelector("iframe")).toBeNull();
    expect(mount({ id: "e2", text: "[app] nothing" } as Partial<Message> & { id: string }).textContent).toContain("[app] nothing");
  });
});
