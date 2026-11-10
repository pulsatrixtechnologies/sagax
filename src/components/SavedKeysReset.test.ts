// @vitest-environment happy-dom
// Issue #3320: an unreadable desktop key store gets a "Reset saved keys" way out, with no confirmation dialog.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SavedKeysResetButton, SavedKeysResetNotice } from "./SavedKeysReset";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Answer = { status: "reset" | "quitting" | "failed" | "readable"; error?: string };
let host: HTMLDivElement;
let root: Root;
let answer: ((value: Answer) => void) | undefined;
let unreadable = true;
const reset = vi.fn(() => new Promise<Answer>((resolve) => { answer = resolve; }));

beforeEach(() => {
  reset.mockClear();
  unreadable = true;
  answer = undefined;
  (window as unknown as { ogb: unknown }).ogb = { credentialStore: { unreadable: async () => unreadable, reset } };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  // The running reset is shared by every button, so settle it before the next test.
  await act(async () => { answer?.({ status: "reset" }); });
  act(() => root.unmount());
  host.remove();
  delete (window as unknown as { ogb?: unknown }).ogb;
});

const render = async (element: ReturnType<typeof createElement>) => {
  await act(async () => { root.render(element); });
  return host.querySelector("button") as HTMLButtonElement | null;
};

describe("Reset saved keys", () => {
  it("resets on the first click without asking again, once however often it is clicked", async () => {
    const button = (await render(createElement(SavedKeysResetButton)))!;
    await act(async () => { button.click(); button.click(); });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    await act(async () => { answer?.({ status: "reset" }); });
    expect(button.disabled).toBe(false);
  });

  it("shows why when the file could not be moved aside", async () => {
    const button = (await render(createElement(SavedKeysResetButton)))!;
    await act(async () => { button.click(); });
    await act(async () => { answer?.({ status: "failed", error: "EBUSY: resource busy or locked" }); });
    expect(host.querySelector("[role=alert]")?.textContent).toContain("EBUSY");
  });

  it("is absent when the saved keys were read", async () => {
    unreadable = false;
    expect(await render(createElement(SavedKeysResetNotice))).toBeNull();
    expect(host.querySelector("[data-saved-keys-notice]")).toBeNull();
  });

  it("comes with its own warning line on a page with no other notice to sit in", async () => {
    const button = await render(createElement(SavedKeysResetNotice));
    expect(button?.textContent).toBe("Reset saved keys");
    expect(host.querySelector("[data-saved-keys-notice]")?.textContent).toContain("could not be read");
  });
});
