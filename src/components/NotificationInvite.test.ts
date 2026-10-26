// @vitest-environment happy-dom
// Settings > Notifications: the one-line invite to turn notifications on
// (JC 2026-10-21, #876: never in the chat).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationInvite, shouldInviteNotifications } from "./NotificationInvite";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const fake = { permission: "default" as NotificationPermission };
const requestPermission = vi.fn<() => Promise<NotificationPermission>>();

function fakeNotification(permission: NotificationPermission) {
  fake.permission = permission;
  // a live getter (Object.assign would copy the value once)
  const ctor = Object.defineProperty(Object.assign(function () {}, { requestPermission }), "permission", { get: () => fake.permission });
  vi.stubGlobal("Notification", ctor);
}

beforeEach(() => {
  requestPermission.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = () => act(() => root.render(createElement(NotificationInvite)));
const row = () => host.querySelector("[data-notification-invite]");
const enable = () => act(() => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Enable")!.click());
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe("NotificationInvite (Settings)", () => {
  it("shows only while permission was never asked", () => {
    fakeNotification("granted");
    expect(shouldInviteNotifications()).toBe(false);
    fakeNotification("denied");
    expect(shouldInviteNotifications()).toBe(false);
    fakeNotification("default");
    expect(shouldInviteNotifications()).toBe(true);
  });

  it("is one line with a single Enable button", () => {
    fakeNotification("default");
    render();
    expect(row()?.textContent).toContain("Let your bots notify you when something needs your attention");
    expect(host.querySelectorAll("button")).toHaveLength(1);
  });

  it("asks for the permission and goes away once granted", async () => {
    fakeNotification("default");
    requestPermission.mockImplementation(async () => { fake.permission = "granted"; return "granted"; });
    render();
    enable();
    await flush();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(row()).toBeNull();
  });

  it("stays when the browser prompt was closed without a choice", async () => {
    fakeNotification("default");
    requestPermission.mockResolvedValue("default");
    render();
    enable();
    await flush();
    expect(row()).not.toBeNull();
    expect(host.querySelector("button")!.disabled).toBe(false);
  });

  it("survives a rejected request", async () => {
    fakeNotification("default");
    requestPermission.mockRejectedValue(new Error("blocked"));
    render();
    enable();
    await flush();
    expect(row()).not.toBeNull();
    expect(host.querySelector("button")!.disabled).toBe(false);
  });

  it("follows the permission when there is nothing to ask (null)", () => {
    fakeNotification("default");
    render();
    // the permission changed elsewhere: requestNotificationPermission returns null
    fake.permission = "denied";
    enable();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(row()).toBeNull();
  });

  it("draws nothing where notifications do not exist", () => {
    vi.stubGlobal("Notification", undefined);
    render();
    expect(row()).toBeNull();
  });
});
