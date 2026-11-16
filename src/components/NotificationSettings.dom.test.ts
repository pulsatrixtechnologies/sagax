// @vitest-environment happy-dom
// #2080 L2: Notifications sound selector (None mutes), one "On this computer"
// mention (the page intro), Privacy card visible in solo with blocked people.
// #4457: the Privacy rows (PrivacyRows) are a card of Permissions now; the
// mount draws them beside More notifications, as Settings draws both.
import { act, createElement, Fragment } from "react";
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
  alone: false,
}));

vi.mock("@/lib/server-alone", () => ({
  useServerAlone: () => fixture.alone,
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

// #3432: « Ce que je reçois » has its own test (settings/ProactiveReceiveSettings.dom.test.ts)
vi.mock("./settings/ProactiveReceiveSettings", () => ({
  ProactiveReceiveSettings: () => "RECEIVE_SETTINGS_MARKER",
}));

vi.mock("./NotificationInvite", () => ({
  NotificationInvite: () => null,
}));

import { NotificationSettings, PrivacyRows } from "./NotificationSettings";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  fixture.sounds = true;
  fixture.soundChoice = "system";
  fixture.blocked = [];
  fixture.admin = false;
  fixture.alone = false;
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

const mount = (privacy = false, organization = privacy) => {
  act(() => {
    root.render(createElement(Fragment, null,
      createElement(NotificationSettings, { organization }),
      createElement("section", { "data-privacy-rows": "" }, createElement(PrivacyRows, { privacy }))));
  });
};

describe("NotificationSettings (#2080)", () => {
  // #3719: a routine that failed or waits never interrupts, so no switch for it
  it("shows no Routines type switch", () => {
    mount();
    expect(host.querySelector('[data-row-id="notifyRoutines"], [data-settings-row="notifyRoutines"], #notifyRoutines')).toBeNull();
    expect(host.querySelector('[role="switch"][aria-label="Routines"], button[aria-label="Routines"]')).toBeNull();
    expect(host.querySelector('[aria-label="Approvals"]')).not.toBeNull();
  });

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
    mount(true);
    expect(host.textContent).not.toMatch(/On this computer/);
    expect(host.textContent).toContain("Alerts");
    expect(host.textContent).toContain("Blocked people");
  });

  it("shows the Privacy card in solo with only blocked people", () => {
    fixture.blocked = [{ id: "p1", name: "Alex" }, { id: "p2", name: "Sam" }];
    mount(false);
    expect(host.querySelector("[data-privacy-rows]")?.childElementCount).toBeGreaterThan(0);
    expect(host.textContent).toContain("Blocked people");
    expect(host.textContent).toContain("2 people");
    expect(host.textContent).not.toContain("Send read receipts");
    expect(host.querySelector('[data-settings-card="notifications.reports"]')).toBeNull();
  });

  it("shows a person alone no Privacy card, no reports and no organization wording (#4360)", () => {
    fixture.admin = true;
    fixture.alone = true;
    mount(false, false);
    expect(host.querySelector("[data-privacy-rows]")?.childElementCount).toBe(0);
    expect(host.querySelector('[data-settings-card="notifications.reports"]')).toBeNull();
    expect(host.textContent).not.toContain("Blocked people");
    expect(host.textContent).not.toContain("Perspicax");
    expect(host.textContent).toContain("A short notice while the server updates or can't be reached.");
  });

  it("keeps Privacy and reports for the owner of a server with other people, without an organization (#4360)", () => {
    fixture.admin = true;
    fixture.alone = false;
    mount(false, false);
    expect(host.querySelector("[data-privacy-rows]")?.childElementCount).toBeGreaterThan(0);
    expect(host.textContent).toContain("Blocked people");
    expect(host.querySelector('[data-settings-card="notifications.reports"]')).toBeTruthy();
    expect(host.textContent).not.toContain("Perspicax");
  });

  it("keeps blocked people for a person alone who blocked someone before (#4360)", () => {
    fixture.admin = true;
    fixture.alone = true;
    fixture.blocked = [{ id: "p2", name: "Former guest" }];
    mount(false, false);
    expect(host.querySelector("[data-privacy-rows]")?.childElementCount).toBeGreaterThan(0);
    expect(host.textContent).toContain("Blocked people");
    expect(host.querySelector('[data-settings-card="notifications.reports"]')).toBeNull();
  });

  it("keeps Privacy, reports and the organization wording on an organization server (#4360)", () => {
    fixture.admin = true;
    mount(true, true);
    expect(host.querySelector("[data-privacy-rows]")?.childElementCount).toBeGreaterThan(0);
    expect(host.textContent).toContain("Blocked people");
    expect(host.querySelector('[data-settings-card="notifications.reports"]')).toBeTruthy();
    expect(host.textContent).toContain("or while Perspicax is unreachable.");
  });

  it("speaks to a person alone in French (#4360)", () => {
    setLocale("fr");
    fixture.alone = true;
    mount(false, false);
    expect(host.textContent).toContain("Un court avis pendant une mise à jour du serveur ou quand il est injoignable.");
    expect(host.textContent).not.toContain("Perspicax");
  });

  it("shows the daily budget and quiet hours in solo too (#2695)", () => {
    mount(false);
    expect(host.textContent).toContain("Daily budget");
    expect(host.textContent).toContain("Quiet hours");
    // #3432: « Ce que je reçois » right after the budget and quiet hours
    expect(host.textContent).toMatch(/Quiet hours[\s\S]*RECEIVE_SETTINGS_MARKER/);
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
