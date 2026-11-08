// @vitest-environment happy-dom
// 2026-11-05 (the owner): a limit notice in the chat can be closed, and stays closed.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
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
