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

describe("profileMenuItems (the reference design's account menu, 2026-10-16)", () => {
  const noop = () => {};
  const handlers = {
    onAutomations: noop, onMemory: noop, onTeamMap: noop, onRemoteSessions: noop, onSettings: noop, onAchievements: noop, onShortcuts: noop, onReleaseNotes: noop, onAbout: noop,
    onViewUsage: noop, onSwitch: noop, onRename: noop, onAddOrganization: noop, onSignOut: noop, onMobile: noop,
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

  const toolsOf = (menu: ReturnType<typeof items>) => menu.find((entry) => entry.key === "tools")!;

  it("is Usage, Help, Settings, then Tools, in that order", () => {
    expect(items().map((entry) => entry.key)).toEqual(["usage", "help", "settings", "tools"]);
  });

  it("puts Automations, Memory, Team map, Remote sessions and Achievements under Tools, in that order", () => {
    const tools = toolsOf(items());
    expect(tools.label).toBe("Tools");
    expect(tools.submenu!.map((entry) => entry.key)).toEqual(["routines", "memory", "team-map", "remote-sessions", "achievements"]);
    expect(toolsOf(items({ achievementsLabel: null })).submenu!.map((entry) => entry.key)).toEqual(["routines", "memory", "team-map", "remote-sessions"]);
  });

  it("shows Remote sessions only on an organization server", () => {
    const keys = (remoteSessions: boolean) => toolsOf(items({ remoteSessions })).submenu!.map((entry) => entry.key);
    expect(keys(false)).toEqual(["routines", "memory", "team-map", "achievements"]);
    expect(keys(true)).toEqual(["routines", "memory", "team-map", "remote-sessions", "achievements"]);
  });

  it("opens the Remote sessions page from Tools", () => {
    let opened = 0;
    const entry = toolsOf(items({ handlers: { ...handlers, onRemoteSessions: () => { opened += 1; } } })).submenu!.find((item) => item.key === "remote-sessions")!;
    expect(entry).toBeTruthy();
    entry.onSelect!();
    expect(opened).toBe(1);
  });

  it("lists neither Approvals nor Code: both open from their address (#approvals, #code)", () => {
    const labels = items().flatMap((entry) => [entry.key, entry.label]);
    for (const gone of ["approvals", "code", "Approvals", "Code"]) expect(labels).not.toContain(gone);
    expect(SOURCE).not.toMatch(/showCode|data-menu-count="approvals"/);
    // the avatar's approvals dot is the one way in from the foot
    expect(SOURCE.match(/showApprovals/g)).toHaveLength(1);
  });

  it("opens Team map from Tools (Owner, 2026-10-27; Memory sits between Automations and Team map)", () => {
    let opened = 0;
    const tools = toolsOf(items({ teamMapActive: true, handlers: { ...handlers, onTeamMap: () => { opened += 1; } } }));
    const entry = tools.submenu!.find((item) => item.key === "team-map")!;
    expect(entry.label).toBe("Team map");
    expect(entry.active).toBe(true);
    expect(tools.active).toBe(true);
    entry.onSelect!();
    expect(opened).toBe(1);
    // one place in the menu: Tools only, never the top level
    expect(items().some((item) => item.key === "team-map")).toBe(false);
  });

  it("leaves Team map out of Tools in the remote client", () => {
    expect(toolsOf(items({ teamMap: false })).submenu!.some((entry) => entry.key === "team-map")).toBe(false);
  });

  it("opens Automations from Tools and keeps the tour anchor, with no dot (Owner, 2026-10-18)", () => {
    let opened = 0;
    const tools = toolsOf(items({
      automationsActive: true,
      handlers: { ...handlers, onAutomations: () => { opened += 1; } },
    }));
    const entry = tools.submenu!.find((item) => item.key === "routines")!;
    expect(entry.label).toBe("Automations");
    expect(entry.tourId).toBe("nav-automations");
    expect(entry.active).toBe(true);
    expect(tools.active).toBe(true);
    expect(tools.attention).toBeFalsy();
    expect(tools.attentionTone).toBeUndefined();
    entry.onSelect!();
    expect(opened).toBe(1);
  });

  it("names Tools Outils in French", () => {
    setLocale("fr");
    try {
      expect(toolsOf(items()).label).toBe("Outils");
    } finally {
      setLocale("en");
    }
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

  it("names the starred plan beside Usage, and stars each plan once in Usage ›", () => {
    const toggled: string[] = [];
    const lines = [
      { key: "grok:weekly", planId: "grok", planName: "Grok SuperGrok Heavy", label: "Grok SuperGrok Heavy · Weekly", value: "87% used" },
      { key: "grok:five-hour", planId: "grok", planName: "Grok SuperGrok Heavy", label: "Grok SuperGrok Heavy · 5-hour", value: "10% used" },
      { key: "codex:five-hour", planId: "codex", planName: "Codex Business", label: "Codex Business · 5-hour", value: "100% used" },
    ];
    const usage = items({
      usagePercent: 87, usageName: "Grok", usageLines: lines,
      usageFavorite: { id: "grok", onToggle: (id) => toggled.push(id) },
    }).find((entry) => entry.key === "usage")!;
    expect(usage.value).toBe("Grok 87%");
    const stars = usage.submenu!.filter((entry) => entry.favorite);
    expect(stars.map((entry) => [entry.key, entry.favorite!.on])).toEqual([["grok:weekly", true], ["codex:five-hour", false]]);
    expect(stars[1]!.favorite!.label).toBe("Show Codex Business in the Usage menu");
    stars[1]!.favorite!.onToggle();
    expect(toggled).toEqual(["codex"]);
    // the usual figure, unnamed, without a favorite
    expect(items({ usagePercent: 100, usageName: null, usageLines: lines }).find((entry) => entry.key === "usage")!.value).toBe("100% used");
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
      switchTargets: [{ id: "local", name: "Cet ordinateur (solo)", local: true, active: true }, { id: "acme", name: "Acme", local: false, active: false }],
      canAddOrganization: true,
      signOut: true,
    });
    expect(menu.map((entry) => entry.key).slice(-2)).toEqual(["switch-organization", "sign-out"]);
    expect(menu.filter((entry) => entry.separatorBefore).map((entry) => entry.key)).toEqual(["switch-organization"]);
    const switching = menu.find((entry) => entry.key === "switch-organization")!;
    expect(switching.submenu!.map((entry) => [entry.key, entry.checked ?? false])).toEqual([
      ["switch:local", true], ["switch:acme", false], ["add-organization", false],
    ]);
    expect(items().some((entry) => entry.separatorBefore)).toBe(false);
  });

  it("opens Switch account on the accounts it was given, the current one checked", () => {
    let switched = "";
    const menu = items({
      accounts: [
        { id: "local", name: "This computer", local: true, active: false, switchable: true },
        { id: "north", name: "North office", local: false, active: true, switchable: false },
      ],
      signOut: true,
      handlers: { ...handlers, onSwitch: (id) => { switched = id; } },
    });
    expect(menu.map((entry) => entry.key).slice(-2)).toEqual(["switch-account", "sign-out"]);
    expect(menu.some((entry) => entry.key === "switch-organization")).toBe(false);
    const row = menu.find((entry) => entry.key === "switch-account")!;
    expect(row.label).toBe("Switch account");
    expect(row.submenu).toBeTruthy();
    expect(row.separatorBefore).toBe(true);
    expect(row.submenu!.map((entry) => [entry.key, entry.label, entry.checked ?? false])).toEqual([
      ["switch:local", "This computer", false],
      ["switch:north", "North office", true],
    ]);
    row.submenu![0]!.onSelect!();
    expect(switched).toBe("local");
    expect(row.submenu![1]!.onSelect).toBeUndefined();
  });

  it("offers Rename on a server row only, with its host as a quiet line", () => {
    let renamed = "";
    const menu = items({
      accounts: [
        { id: "local", name: "Personal", local: true, active: false, switchable: true, renamable: false },
        { id: "north", name: "North office", local: false, active: true, switchable: true, renamable: true, host: "bot.example.com", defaultName: "bot.example.com" },
      ],
      signOut: true,
      handlers: { ...handlers, onRename: (entry) => { renamed = `${entry.id}|${entry.name}|${entry.defaultName}`; } },
    });
    const rows = menu.find((entry) => entry.key === "switch-account")!.submenu!;
    expect(rows[0]!.rename).toBeUndefined();
    expect(rows[1]!.subtitle).toBe("bot.example.com");
    expect(rows[1]!.title).toBe("bot.example.com");
    expect(rows[1]!.rename!.label).toBe("Rename");
    rows[1]!.rename!.onRename();
    expect(renamed).toBe("north|North office|bot.example.com");
  });

  it("keeps the current account in the submenu when it is the only one, in French", () => {
    setLocale("fr");
    try {
      const menu = items({
        accounts: [{ id: "current", name: "North office", local: false, active: true, switchable: false }],
        signOut: true,
      });
      const row = menu.find((entry) => entry.key === "switch-account")!;
      expect(row.label).toBe("Changer de compte");
      expect(row.submenu).toEqual([expect.objectContaining({
        key: "switch:current", label: "North office", checked: true,
      })]);
      expect(row.submenu![0]!.onSelect).toBeUndefined();
      expect(menu.some((entry) => entry.key === "add-organization" || entry.submenu?.some((entry) => entry.key === "add-organization"))).toBe(false);
    } finally {
      setLocale("en");
    }
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
