// @vitest-environment happy-dom
// 2026-11-05 (the owner): a limit notice in the chat can be closed, and stays closed.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadLocale, setLocale } from "@/lib/i18n";
import type { Message } from "@/state/store";
import { StatusActivityRow } from "./StatusActivityRow";

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(() => { flushSync(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; });
function mount(message: Message): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(createElement(StatusActivityRow, { message })));
  return host;
}
beforeAll(() => setLocale("en"));

describe("status notice", () => {
  it("closes on its button and stays closed on the next mount", () => {
    const message = { id: "limit-1", role: "bot", kind: "activity", at: 0, text: "",
      tool: { name: "limit", ok: true, limitFailover: { kind: "waiting", from: "Claude", resetsAt: Date.now() + 3_600_000 } } } as Message;
    let view = mount(message);
    expect(view.textContent).toContain("Limit reached on Claude");
    flushSync(() => view.querySelector<HTMLButtonElement>("button[aria-label='Close']")!.click());
    expect(view.textContent).toBe("");
    flushSync(() => root?.unmount()); host?.remove();
    view = mount(message);
    expect(view.textContent).toBe("");
  });
});

// QA 0.8.66 F1: a cold start (458 s after a roll) read as a silent chat.
describe("environment starting notice", () => {
  const notice = { id: "wake-1", role: "bot", kind: "activity", at: Date.now() - 42_000, text: "",
    tool: { name: "notice: The server environment is starting. This can take a few minutes.", ok: true } } as Message;
  function mountWith(props: { message: Message; transcript?: Message[]; busy?: boolean }): HTMLElement {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    flushSync(() => root!.render(createElement(StatusActivityRow, props)));
    return host;
  }

  it("counts its seconds while the turn waits on it", () => {
    const view = mountWith({ message: notice, transcript: [notice], busy: true });
    expect(view.textContent).toMatch(/The server environment is starting, 4[2-3] s/);
  });

  it("stops counting once the turn moved on or ended", () => {
    const after = { id: "tool-1", role: "bot", kind: "activity", at: Date.now(), tool: { name: "Bash", ok: true } } as Message;
    let view = mountWith({ message: notice, transcript: [notice, after], busy: true });
    expect(view.textContent).not.toMatch(/\d+ s/);
    flushSync(() => root?.unmount()); host?.remove();
    view = mountWith({ message: notice, transcript: [notice], busy: false });
    expect(view.textContent).not.toMatch(/\d+ s/);
  });

  it("reads in French", async () => {
    await loadLocale("fr");
    try {
      const view = mountWith({ message: notice, transcript: [notice], busy: true });
      expect(view.textContent).toMatch(/Environnement en démarrage, 4[2-3] s/);
    } finally {
      setLocale("en");
    }
  });
});
