import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  footerMenuItems,
  profileInitials,
  profileLabel,
  profileMenuItems,
  updateBusy,
  updateNoteworthy,
  updateLabel,
  updatePhase,
} from "./SidebarProfileMenu";
import { APP_REPOSITORY, DOCS_URL, HELP_CENTER_URL, LICENSE_URL, platformLabel } from "@/lib/app-links";
import type { UpdaterState } from "@/lib/updater";
import { setLocale } from "@/lib/i18n";

const SOURCE = readFileSync(new URL("./SidebarProfileMenu.tsx", import.meta.url), "utf8");
const state = (patch: Partial<UpdaterState>): UpdaterState => ({ status: "idle", ...patch }) as UpdaterState;

describe("profileInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(profileInitials({ name: "Milind Soni" })).toBe("MS");
    expect(profileInitials({ name: "Ada Byron Lovelace" })).toBe("AB");
  });

  it("falls back to the email, then to a placeholder", () => {
    expect(profileInitials({ email: "you@x.dev" })).toBe("Y");
    expect(profileInitials({})).toBe("?");
    expect(profileInitials(undefined)).toBe("?");
  });

  it("ignores whitespace-only names", () => {
    expect(profileInitials({ name: "   ", email: "you@x.dev" })).toBe("Y");
  });
});

describe("profileLabel", () => {
  it("prefers the name, then the email, then You", () => {
    expect(profileLabel({ name: "Omkar", email: "o@x.dev" })).toBe("Omkar");
    expect(profileLabel({ email: "o@x.dev" })).toBe("o@x.dev");
    expect(profileLabel(undefined)).toBe("You");
  });
});

describe("updatePhase", () => {
  it("reports the bridge's own in-flight states", () => {
    expect(updatePhase(state({ status: "checking" }), false)).toBe("checking");
    expect(updatePhase(state({ status: "downloading" }), false)).toBe("downloading");
    expect(updatePhase(state({ status: "preparing" }), false)).toBe("preparing");
    expect(updatePhase(state({ status: "installing" }), false)).toBe("installing");
  });

  it("acknowledges a check that found nothing", () => {
    expect(updatePhase(null, true)).toBe("up-to-date");
    expect(updatePhase(null, false)).toBe("idle");
  });

  // the acknowledgement is only for a genuinely quiet result — a found
  // update must not be papered over by a stale "up to date"
  it("lets a real status outrank the acknowledgement", () => {
    expect(updatePhase(state({ status: "downloading" }), true)).toBe("downloading");
  });
});

describe("updateLabel", () => {
  it("names the version it is ready to install", () => {
    expect(updateLabel("downloaded", state({ status: "downloaded", version: "0.2.0" }))).toBe(
      "Version 0.2.0 ready · Restart",
    );
  });

  it("shows progress only once there is a percentage", () => {
    expect(updateLabel("downloading", state({ status: "downloading" }))).toBe("Starting download…");
    expect(updateLabel("downloading", state({ status: "downloading", percent: 41.6 }))).toBe("Downloading… 42%");
  });

  it("distinguishes native preparation from restart readiness", () => {
    expect(updateLabel("preparing", state({ status: "preparing", percent: 100 }))).toBe("Preparing update…");
    expect(updateLabel("installing", state({ status: "installing", message: "Restart is taking longer than expected." })))
      .toBe("Restart is taking longer than expected.");
    expect(updateLabel("downloaded", state({ status: "downloaded", version: "0.2.0", installMode: "handoff" })))
      .toBe("Version 0.2.0 ready · Install");
    expect(updateLabel("installing", state({ status: "installing", installMode: "handoff" })))
      .toBe("Opening a terminal…");
  });

  it("carries the updater's own message when something failed", () => {
    expect(updateLabel("error", state({ status: "error", message: "Network unreachable" }))).toBe(
      "Network unreachable",
    );
    expect(updateLabel("error", state({ status: "error" }))).toBe("Update failed. Try again");
  });

  it("points a hand-off at the terminal that finishes it", () => {
    expect(updateLabel("handed-off", state({ status: "handed-off" }))).toBe(
      "Finish the update in your terminal",
    );
  });

  it("defaults to the invitation to check", () => {
    expect(updateLabel("idle", null)).toBe("Check for updates");
    expect(updateLabel("up-to-date", null)).toBe("You're up to date");
  });
});

describe("updateBusy", () => {
  it("blocks clicks while something is in flight", () => {
    expect(updateBusy("checking")).toBe(true);
    expect(updateBusy("downloading")).toBe(true);
    expect(updateBusy("preparing")).toBe(true);
    expect(updateBusy("installing")).toBe(true);
    expect(updateBusy("downloaded")).toBe(false);
    expect(updateBusy("idle")).toBe(false);
  });

  // the click starts a round-trip through main; until it lands, the status
  // still reads "downloaded" and the row would otherwise invite a second click
  it("blocks the gap between the click and the bridge catching up", () => {
    expect(updateBusy("downloaded", true)).toBe(true);
    expect(updateBusy("error", true)).toBe(true);
  });
});

describe("platformLabel", () => {
  it("names the platforms we ship, and stays quiet otherwise", () => {
    expect(platformLabel("darwin")).toBe("macOS");
    expect(platformLabel("win32")).toBe("Windows");
    expect(platformLabel("linux")).toBe("Linux");
    expect(platformLabel("freebsd")).toBeNull();
    expect(platformLabel(undefined)).toBeNull();
  });
});

describe("updateNoteworthy", () => {
  it("puts a real update on the profile row", () => {
    expect(updateNoteworthy("downloading")).toBe(true);
    expect(updateNoteworthy("preparing")).toBe(true);
    expect(updateNoteworthy("downloaded")).toBe(true);
    expect(updateNoteworthy("installing")).toBe(true);
    expect(updateNoteworthy("error")).toBe(true);
    expect(updateNoteworthy("handed-off")).toBe(true);
  });

  // a check the user started from inside the open menu is answered there;
  // badging the row for it would flash at someone already looking elsewhere
  it("leaves a quiet updater quiet", () => {
    expect(updateNoteworthy("idle")).toBe(false);
    expect(updateNoteworthy("checking")).toBe(false);
    expect(updateNoteworthy("up-to-date")).toBe(false);
  });

  it("shows the click that has not landed yet", () => {
    expect(updateNoteworthy("idle", true)).toBe(true);
  });
});

describe("outward links", () => {
  // both were pointed somewhere else once; pin them so a future tidy-up of
  // app-links does not quietly send Help back to the README
  it("sends Help Center, docs, and the license to this fork", () => {
    expect(HELP_CENTER_URL).toBe(DOCS_URL);
    expect(DOCS_URL).toBe(`${APP_REPOSITORY}/tree/main/docs`);
    expect(LICENSE_URL).toBe(`${APP_REPOSITORY}/blob/main/LICENSE`);
    expect(APP_REPOSITORY).toBe("https://github.com/pulsatrixtechnologies/sagax");
  });
});

describe("profileMenuItems (Grok Bot's account menu, 2026-10-16)", () => {
  const noop = () => {};
  const handlers = {
    onAutomations: noop, onRemoteSessions: noop, onSettings: noop, onAchievements: noop, onShortcuts: noop, onReleaseNotes: noop, onAbout: noop,
    onViewUsage: noop, onSwitch: noop, onAddOrganization: noop, onSignOut: noop, onMobile: noop,
  };
  const items = (patch: Partial<Parameters<typeof profileMenuItems>[0]> = {}) => profileMenuItems({
    usagePercent: 42,
    usageLines: [{ key: "claude:weekly", label: "Claude Max · Weekly", value: "42% used" }],
    monthCost: "$3.10",
    mobile: false,
    achievementsLabel: "Achievements",
    automationsActive: false,
    remoteSessionsActive: false,
    updateItem: null,
    switchTargets: [],
    canAddOrganization: false,
    signOut: false,
    handlers,
    ...patch,
  });

  it("is Usage, Help, Settings, Automations, Remote sessions and Achievements, in that order", () => {
    expect(items().map((entry) => entry.key)).toEqual(["usage", "help", "settings", "routines", "remote-sessions", "achievements"]);
  });

  it("opens the Remote sessions page next to Automations", () => {
    let opened = 0;
    const entry = items({ handlers: { ...handlers, onRemoteSessions: () => { opened += 1; } } }).find((item) => item.key === "remote-sessions")!;
    expect(entry).toBeTruthy();
    entry.onSelect();
    expect(opened).toBe(1);
  });

  it("lists neither Approvals nor Code: both open from their address (#approvals, #code)", () => {
    const labels = items().flatMap((entry) => [entry.key, entry.label]);
    for (const gone of ["approvals", "code", "Approvals", "Code"]) expect(labels).not.toContain(gone);
    expect(SOURCE).not.toMatch(/showCode|data-menu-count="approvals"/);
    // the avatar's approvals dot is the one way in from the foot
    expect(SOURCE.match(/showApprovals/g)).toHaveLength(1);
  });

  it("has no Team map: it opens from the Automations header and the palette (JC, 2026-10-18)", () => {
    expect(items().some((entry) => entry.key === "team-map" || entry.label === "Team map")).toBe(false);
  });

  it("opens Automations from the menu and keeps the tour anchor, with no dot (JC, 2026-10-18)", () => {
    let opened = 0;
    const entry = items({ handlers: { ...handlers, onAutomations: () => { opened += 1; } } }).find((item) => item.key === "routines")!;
    expect(entry.label).toBe("Automations");
    expect(entry.tourId).toBe("nav-automations");
    expect(entry.attention).toBeFalsy();
    expect(entry.attentionTone).toBeUndefined();
    entry.onSelect();
    expect(opened).toBe(1);
  });

  it("leaves Browse bots, Check for updates, Keyboard shortcuts and About out of the first level", () => {
    const update = { key: "update", label: "Check for updates", onSelect: noop };
    const keys = items({ updateItem: update }).map((entry) => entry.key);
    for (const gone of ["browse-bots", "update", "shortcuts", "about"]) expect(keys).not.toContain(gone);
  });

  it("shows the plan's percent in grey beside Usage, and no percent without a plan", () => {
    setLocale("fr");
    try {
      const usage = items().find((entry) => entry.key === "usage")!;
      expect(usage.label).toBe("Utilisation");
      expect(usage.value).toBe("42\u00a0% utilisé");
      expect(usage.submenu!.map((entry) => entry.key)).toEqual(["claude:weekly", "month-cost", "view-usage"]);
      expect(usage.submenu!.find((entry) => entry.key === "view-usage")).toMatchObject({ label: "Voir l'utilisation", separatorBefore: true });
      const bare = items({ usagePercent: null, usageLines: [], monthCost: null }).find((entry) => entry.key === "usage")!;
      expect(bare.value).toBeUndefined();
      expect(bare.submenu!.map((entry) => entry.key)).toEqual(["view-usage"]);
    } finally {
      setLocale("en");
    }
  });

  it("puts Keyboard shortcuts, Release notes, Check for updates and About under Help", () => {
    const update = { key: "update", label: "Check for updates", onSelect: noop };
    expect(items({ updateItem: update }).find((entry) => entry.key === "help")!.submenu!.map((entry) => entry.key))
      .toEqual(["shortcuts", "release-notes", "update", "about"]);
    expect(items().find((entry) => entry.key === "help")!.submenu!.map((entry) => entry.key))
      .toEqual(["shortcuts", "release-notes", "about"]);
  });

  it("offers Get Sagax on mobile only with a link", () => {
    expect(items().some((entry) => entry.key === "mobile")).toBe(false);
    expect(items({ mobile: true }).map((entry) => entry.key).indexOf("mobile")).toBe(1);
  });

  it("ends with a hairline, Switch organization and Sign out where they apply", () => {
    const menu = items({
      switchTargets: [{ id: "local", name: "Cet ordinateur (solo)", local: true, active: true }, { id: "gox", name: "GOX", local: false, active: false }],
      canAddOrganization: true,
      signOut: true,
    });
    expect(menu.map((entry) => entry.key).slice(-2)).toEqual(["switch-organization", "sign-out"]);
    expect(menu.filter((entry) => entry.separatorBefore).map((entry) => entry.key)).toEqual(["switch-organization"]);
    const switching = menu.find((entry) => entry.key === "switch-organization")!;
    expect(switching.submenu!.map((entry) => [entry.key, entry.checked ?? false])).toEqual([
      ["switch:local", true], ["switch:gox", false], ["add-organization", false],
    ]);
    expect(items().some((entry) => entry.separatorBefore)).toBe(false);
  });
});

describe("footerMenuItems", () => {
  const item = (key: string, separatorBefore?: boolean) => ({ key, label: key, separatorBefore, onSelect: () => {} });

  it("adds the places to the group just above the hairline", () => {
    const merged = footerMenuItems(
      [item("archived")],
      [item("usage"), item("settings"), item("team-map"), item("switch-organization", true), item("sign-out")],
    );
    expect(merged.map((entry) => entry.key)).toEqual(["usage", "settings", "team-map", "archived", "switch-organization", "sign-out"]);
  });

  it("ends with the places when there is no hairline, and is the profile menu alone without places", () => {
    expect(footerMenuItems([item("archived")], [item("usage"), item("team-map")]).map((entry) => entry.key)).toEqual(["usage", "team-map", "archived"]);
    const profile = [item("usage"), item("settings")];
    expect(footerMenuItems([], profile)).toBe(profile);
  });
});
