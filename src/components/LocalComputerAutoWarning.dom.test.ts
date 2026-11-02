// @vitest-environment happy-dom
// 2026-10-26 (owner): Auto on This computer is the person's own machine. The
// warning shows the first time; after that OK it confirms itself, on every
// bot and every conversation, so no card stands between the person and
// their own computer.
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOCAL_AUTO_ACK_KEY, localAutoAcknowledged, resetLocalAutoAck } from "@/lib/local-auto-ack";
import { LocalComputerAutoWarning } from "./LocalComputerAutoWarning";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
beforeEach(() => {
  window.localStorage.clear();
  resetLocalAutoAck();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mount(onConfirm: () => void, onCancel: () => void = () => {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(LocalComputerAutoWarning, { open: true, onCancel, onConfirm })));
  return host;
}

describe("LocalComputerAutoWarning", () => {
  it("shows the warning the first time and remembers the OK", () => {
    const onConfirm = vi.fn();
    mount(onConfirm);
    // ConfirmDialog portals to document.body (alertdialog).
    expect(document.querySelector("[role=alertdialog]")).not.toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
    const ok = document.querySelector("[data-confirm-action]") as HTMLButtonElement;
    act(() => ok.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(LOCAL_AUTO_ACK_KEY)).toBe("1");
    expect(localAutoAcknowledged()).toBe(true);
  });

  it("confirms by itself once the person already said OK on this computer", () => {
    window.localStorage.setItem(LOCAL_AUTO_ACK_KEY, "1");
    const onConfirm = vi.fn();
    mount(onConfirm);
    expect(document.querySelector("[role=alertdialog]")).toBeNull();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("Cancel remembers nothing", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    mount(onConfirm, onCancel);
    const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>("[role=alertdialog] button")).find((button) => !button.hasAttribute("data-confirm-action"))!;
    act(() => cancel.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(localAutoAcknowledged()).toBe(false);
  });
});
