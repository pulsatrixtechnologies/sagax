// @vitest-environment happy-dom
// #2080 L2: Notifications sound selector (None mutes), one "On this computer"
// mention (the page intro), Privacy card visible in solo with blocked people.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({
  sounds: true,
  setSounds: vi.fn(),
  soundChoice: "system" as string,
  setSoundChoice: vi.fn(),
  play: vi.fn(),
  blocked: [] as Array<{ id: string; name: string }>,
  admin: false,
}));

vi.mock("@/lib/notification-preferences", () => {
  const local = (key: string) => ({
    key,
    enabled: () => true,
    set: vi.fn(),
    subscribe: () => () => {},
  });
  return {
    useNotificationSounds: () => fixture.sounds,
    setNotificationSounds: fixture.setSounds,
    useNudgeSound: () => true,
    setNudgeSound: vi.fn(),
    persistentNotifications: local("omb-notification-persistent"),
    notifyBots: local("omb-notify-bots"),
    notifyPeople: local("omb-notify-people"),
    notifyGroups: local("omb-notify-groups"),
    notifyApprovals: local("omb-notify-approvals"),
    notifyRoutines: local("omb-notify-routines"),
    dockBadge: local("omb-dock-badge"),
    nudgeShake: local("omb-nudge-shake"),
    approvalChime: local("omb-approval-chime"),
    connectionNotices: local("omb-connection-notices"),
    useLocalSwitch: (choice: { enabled: () => boolean }) => choice.enabled(),
  };
});

vi.mock("@/lib/notification-sound", () => ({
  NOTIFICATION_SOUND_CHOICES: ["system", "tick", "blip"],
  notificationSoundChoice: {
    use: () => fixture.soundChoice,
    set: (next: string) => fixture.setSoundChoice(next),
    get: () => fixture.soundChoice,
  },
  playNotificationSound: (...args: unknown[]) => fixture.play(...args),
}));

vi.mock("@/lib/moderation", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/moderation")>(),
  useBlockedPeople: () => fixture.blocked,
  unblockPerson: vi.fn(),
  fetchReports: async () => [],
  onReportsChanged: () => () => {},
  resolveReport: vi.fn(),
}));

vi.mock("@/state/store-selector", () => ({
  useStoreSelector: (select: (state: { config: unknown }) => unknown) => select({ config: {} }),
}));

vi.mock("@/lib/group-owner", () => ({
  viewerIsOrgAdmin: () => fixture.admin,
}));

vi.mock("./NotificationInvite", () => ({
  NotificationInvite: () => null,
}));

import { NotificationSettings } from "./NotificationSettings";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  fixture.sounds = true;
  fixture.soundChoice = "system";
  fixture.blocked = [];
  fixture.admin = false;
  fixture.setSounds.mockClear();
  fixture.setSoundChoice.mockClear();
  fixture.play.mockClear();
  setLocale("en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setLocale("en");
});

const mount = (privacy = false) => {
  act(() => {
    root.render(createElement(NotificationSettings, { privacy }));
  });
};

describe("NotificationSettings (#2080)", () => {
  it("selecting None turns notification sounds off", () => {
    mount();
    const trigger = host.querySelector<HTMLButtonElement>('button[data-pill-select][aria-label="Notification sound"]')!;
    act(() => { trigger.click(); });
    const none = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find((row) => row.textContent?.includes("None"))!;
    act(() => { none.click(); });
    expect(fixture.setSounds).toHaveBeenCalledWith(false);
    expect(fixture.play).not.toHaveBeenCalled();
  });

  it("does not repeat On this computer (intro is outside this component)", () => {
    mount();
    expect(host.textContent).not.toMatch(/On this computer/);
    expect(host.textContent).toContain("Alerts");
    expect(host.textContent).toContain("Privacy");
  });

  it("shows the Privacy card in solo with only blocked people", () => {
    fixture.blocked = [{ id: "p1", name: "Alex" }, { id: "p2", name: "Sam" }];
    mount(false);
    expect(host.querySelector('[data-settings-card="notifications.privacy"]')).toBeTruthy();
    expect(host.textContent).toContain("Blocked people");
    expect(host.textContent).toContain("2 people");
    expect(host.textContent).not.toContain("Send read receipts");
    expect(host.querySelector('[data-settings-card="notifications.reports"]')).toBeNull();
  });

  it("shows the daily budget and quiet hours in solo too (#2695)", () => {
    mount(false);
    expect(host.textContent).toContain("Daily budget");
    expect(host.textContent).toContain("Quiet hours");
  });

  it("opens blocked people under Manage", () => {
    fixture.blocked = [{ id: "p1", name: "Alex" }];
    mount();
    const manage = host.querySelector<HTMLButtonElement>('button[aria-label="Blocked people"]')!;
    act(() => { manage.click(); });
    expect(host.textContent).toContain("Alex");
    expect(host.querySelector("[data-unblock]")).toBeTruthy();
  });
});
