// @vitest-environment happy-dom
// Settings > Notifications: the desktop row shows whether the system shows
// Sagax notifications, sends a test and opens the system settings (#2385).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NativeNotificationStatusRow } from "./NativeNotificationStatusRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as { ogb?: unknown }).ogb;
});

const flush = () => act(async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); });
const render = async () => { act(() => root.render(createElement(NativeNotificationStatusRow))); await flush(); };
const row = () => host.querySelector<HTMLElement>("[data-native-notification-status]");
const button = (label: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === label);
const status = (state: NativeNotificationStatus["state"], settings = true): NativeNotificationStatus =>
  ({ state, canCheck: state !== "unknown", platform: "darwin", settings });

describe("NativeNotificationStatusRow", () => {
  it("renders nothing outside the desktop app", async () => {
    await render();
    expect(row()).toBeNull();
  });

  it("shows the state, sends a test with its text and opens the system settings", async () => {
    const testNotification = vi.fn(async () => status("delivered"));
    const openNotificationSettings = vi.fn(async () => true);
    (window as { ogb?: unknown }).ogb = {
      notificationStatus: vi.fn(async () => status("not-delivered")),
      testNotification,
      openNotificationSettings,
    };
    await render();
    expect(row()?.dataset.nativeNotificationStatus).toBe("not-delivered");
    expect(row()?.textContent).toContain("not showing Sagax notifications");

    act(() => button("Send a test")!.click());
    await flush();
    expect(testNotification).toHaveBeenCalledWith({ title: "Sagax notifications work", body: "Your bots can reach you here." });
    expect(row()?.dataset.nativeNotificationStatus).toBe("delivered");

    act(() => button("Notification settings")!.click());
    expect(openNotificationSettings).toHaveBeenCalledTimes(1);
  });

  it("hides the settings button when the platform has no settings page", async () => {
    (window as { ogb?: unknown }).ogb = {
      notificationStatus: vi.fn(async () => status("unknown", false)),
      testNotification: vi.fn(async () => status("unknown", false)),
      openNotificationSettings: vi.fn(async () => false),
    };
    await render();
    expect(row()?.dataset.nativeNotificationStatus).toBe("unknown");
    expect(button("Notification settings")).toBeUndefined();
    expect(button("Send a test")).toBeDefined();
  });
});
