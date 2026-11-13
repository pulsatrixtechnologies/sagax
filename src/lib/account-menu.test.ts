import { describe, expect, it } from "vitest";

import { accountChoices, businessAccount, CURRENT_ACCOUNT_ID, PERSONAL_ID, SAGAX_MOBILE_URL, serverDisplayName, switchAccount, switchTargets, usageLines, usagePercent, usageSummary } from "./account-menu";
import type { PlanRow, PlanWindow } from "./plan-usage";

const closed: PlanWindow = { available: false, remainingPercent: null, usedPercent: null, resetsAt: null };
const open = (used: number, resetsAt: string | null = null): PlanWindow => ({ available: true, remainingPercent: 100 - used, usedPercent: used, resetsAt });
const row = (patch: Partial<PlanRow>): PlanRow => ({
  id: "claude", name: "Claude", driver: "claude", plan: "Max", state: "windows", access: "subscription", instanceId: null, instanceIds: [],
  message: null, fiveHour: closed, weekly: closed, extra: [], models: [], ...patch,
});
const labels = { weekly: "Weekly", fiveHour: "5-hour", used: (n: number) => `${n}% used`, resetsIn: (when: string) => `resets in ${when}` };

describe("the avatar menu's Usage", () => {
  it("shows the most used weekly window of the person's plans", () => {
    expect(usagePercent([row({ weekly: open(12.4) }), row({ id: "codex", weekly: open(87.6) })])).toBe(88);
  });

  it("falls back to the 5-hour window, and has no percent without a plan window", () => {
    expect(usagePercent([row({ fiveHour: open(30) })])).toBe(30);
    expect(usagePercent([])).toBeNull();
    expect(usagePercent([row({ state: "no-windows" })])).toBeNull();
  });

  it("lists each window under its plan, the window and its reset on the second line (#4157)", () => {
    const now = Date.parse("2026-10-16T00:00:00Z");
    const lines = usageLines([row({ weekly: open(42, "2026-10-18T03:00:00Z"), fiveHour: open(5) })], labels, now);
    expect(lines).toEqual([
      { key: "claude:weekly", planId: "claude", planName: "Claude Max", label: "Claude Max", subtitle: "Weekly · resets in 2d 3h", value: "42% used" },
      { key: "claude:five-hour", planId: "claude", planName: "Claude Max", label: "Claude Max", subtitle: "5-hour", value: "5% used" },
    ]);
  });
});

describe("the avatar menu's starred subscription (2026-11-03)", () => {
  const grok = row({ id: "grok", name: "Grok", plan: "SuperGrok Heavy", weekly: open(87) });
  const codex = row({ id: "codex", name: "Codex", plan: "Business", fiveHour: open(100) });

  it("shows the starred plan's own percent and its short name, not the highest", () => {
    expect(usageSummary([codex, grok], "grok")).toEqual({ percent: 87, name: "Grok" });
    expect(usageSummary([codex, grok], "codex")).toEqual({ percent: 100, name: "Codex" });
  });

  it("keeps the highest plan, unnamed, with no favorite", () => {
    expect(usageSummary([grok, codex], null)).toEqual({ percent: 100, name: null });
    expect(usageSummary([], null)).toEqual({ percent: null, name: null });
  });

  it("falls back to the highest once the favorite is gone or reports no window", () => {
    // signed out: connectedPlanRows leaves the row out
    expect(usageSummary([codex], "grok")).toEqual({ percent: 100, name: null });
    expect(usageSummary([codex, row({ id: "grok", name: "Grok", state: "no-windows" })], "grok")).toEqual({ percent: 100, name: null });
    expect(usageSummary([codex, row({ id: "grok", name: "Grok" })], "grok")).toEqual({ percent: 100, name: null });
  });
});

describe("the avatar menu's Switch organization", () => {
  it("lists this computer first, then the saved organization servers, the active one checked", () => {
    const targets = switchTargets({
      activeId: "acme",
      environments: [
        { id: "acme", kind: "remote", name: "Acme", org: true },
        { id: "local", kind: "local", name: "" },
        { id: "lab", kind: "remote", name: "Lab", org: false },
        { id: "gone", kind: "remote", name: "Gone", org: true, missing: true },
      ],
    }, "This computer (solo)");
    expect(targets).toEqual([
      { id: "local", name: "This computer (solo)", local: true, active: false },
      { id: "acme", name: "Acme", local: false, active: true, defaultName: "Acme" },
    ]);
  });

  it("is empty where the app has no server list", () => {
    expect(switchTargets(null, "solo")).toEqual([]);
  });
});

const saved = [
  { id: "local", name: "This computer", local: true, active: false },
  { id: "north", name: "North office", local: false, active: true },
];

describe("the avatar menu's Switch account", () => {
  it("names the locked server, and otherwise the organization", () => {
    expect(businessAccount({ active: true, id: "north", name: " North office " }, "Other")).toEqual({
      id: "north", name: "Other", local: false, defaultName: "Other", custom: false,
    });
    expect(businessAccount({ active: true, id: "north", name: "North office" }, "")).toEqual({
      id: "north", name: "North office", local: false, defaultName: "North office", custom: false,
    });
    expect(businessAccount({ active: false }, " North office ")).toEqual({
      id: CURRENT_ACCOUNT_ID, name: "North office", local: false,
    });
    expect(businessAccount(null, "  ")).toBeNull();
    expect(businessAccount({ active: true, id: " ", name: " " }, null)).toBeNull();
  });

  it("always lists Personal first, even when the person is only on an organization server", () => {
    expect(accountChoices([], { id: CURRENT_ACCOUNT_ID, name: "North office" }, "Personal")).toEqual([
      { id: PERSONAL_ID, name: "Personal", local: true, active: false, switchable: true, renamable: false },
      { id: CURRENT_ACCOUNT_ID, name: "North office", local: false, active: true, switchable: false, renamable: false },
    ]);
    expect(accountChoices([], null, "Personnel").map((entry) => [entry.id, entry.name, entry.switchable])).toEqual([
      ["local", "Personnel", true],
    ]);
  });

  it("names the personal space Personal rather than the saved computer name, and checks it when it is in use", () => {
    const rows = accountChoices([{ id: "local", name: "This computer (solo)", local: true, active: true }], null, "Personal");
    expect(rows).toEqual([{ id: "local", name: "Personal", local: true, active: true, switchable: true, renamable: false }]);
  });

  it("checks the account in use and keeps a saved server switchable and renamable", () => {
    expect(accountChoices(saved, { id: "north", name: "North office" })).toEqual([
      { id: "local", name: "Personal", local: true, active: false, switchable: true, renamable: false },
      { id: "north", name: "North office", local: false, active: true, switchable: true, renamable: true },
    ]);
  });

  it("adds a current account the saved list does not name, and does not duplicate one it does", () => {
    expect(accountChoices(saved, { id: "east", name: "East office", host: "east.example.com", defaultName: "East" })).toEqual([
      { id: "local", name: "Personal", local: true, active: false, switchable: true, renamable: false },
      { id: "north", name: "North office", local: false, active: false, switchable: true, renamable: true },
      { id: "east", name: "East office", local: false, active: true, switchable: false, renamable: true, host: "east.example.com", defaultName: "East" },
    ]);
    expect(accountChoices(saved, { id: CURRENT_ACCOUNT_ID, name: "north office" }).map((entry) => [entry.id, entry.active])).toEqual([
      ["local", false], ["north", true],
    ]);
  });
});

describe("a server's shown name", () => {
  it("is the person's own name, else the organization name the server announced, else its host", () => {
    expect(serverDisplayName({ name: "bot.example.com", label: " Bureau ", orgName: "Acme" })).toBe("Bureau");
    expect(serverDisplayName({ name: "bot.example.com", orgName: "Acme" })).toBe("Acme");
    expect(serverDisplayName({ name: "bot.example.com" })).toBe("bot.example.com");
    expect(serverDisplayName({ name: "bot.example.com", label: "  ", orgName: " " })).toBe("bot.example.com");
  });

  it("shows a saved server under that name, with its host and its default", () => {
    const targets = switchTargets({
      activeId: "local",
      environments: [
        { id: "local", kind: "local", name: "" },
        { id: "a", kind: "remote", name: "bot.example.com", origin: "https://bot.example.com", org: true, orgName: "Acme" },
        { id: "b", kind: "remote", name: "work.example.com", origin: "https://work.example.com", org: true, orgName: "Acme", label: "Bureau" },
        { id: "c", kind: "remote", name: "lab.example.com", origin: "https://lab.example.com", org: true },
      ],
    }, "solo");
    expect(targets.slice(1).map((entry) => [entry.id, entry.name, entry.host, entry.defaultName, entry.custom ?? false])).toEqual([
      ["a", "Acme", "bot.example.com", "Acme", false],
      ["b", "Bureau", "work.example.com", "Acme", true],
      ["c", "lab.example.com", "lab.example.com", "lab.example.com", false],
    ]);
  });

  it("carries the locked server's own name, host and default into Switch account", () => {
    const current = businessAccount({ active: true, id: "n", name: "bot.example.com", origin: "https://bot.example.com", label: "Bureau", orgName: "Acme" }, "Acme");
    expect(current).toEqual({ id: "n", name: "Bureau", local: false, host: "bot.example.com", defaultName: "Acme", custom: true });
    expect(accountChoices([], current).find((entry) => entry.id === "n")).toMatchObject({
      name: "Bureau", host: "bot.example.com", defaultName: "Acme", custom: true, renamable: true, active: true,
    });
  });
});

describe("Get Sagax on mobile", () => {
  it("stays hidden while Sagax has no public App Store or TestFlight link", () => {
    expect(SAGAX_MOBILE_URL).toBeNull();
  });
});

describe("switchAccount", () => {
  it("never signs out: an organization server's page opens Personal through the desktop", async () => {
    const calls: string[] = [];
    // what the bundled page has: no saved-server list, no way to choose another destination
    const orgPage = { accounts: { openPersonal: () => { calls.push("open-personal"); } }, serverMode: { leave: () => { calls.push("leave"); } } };
    await switchAccount(PERSONAL_ID, orgPage);
    await switchAccount("another-server", orgPage);
    expect(calls).toEqual(["open-personal"]);
  });

  it("Personal's page switches to any saved account, the organization server included", async () => {
    const calls: string[] = [];
    const localPage = { environments: { switch: (id: string) => { calls.push(id); } }, accounts: { openPersonal: () => { calls.push("open-personal"); } } };
    await switchAccount("org", localPage);
    await switchAccount(PERSONAL_ID, localPage);
    expect(calls).toEqual(["org", PERSONAL_ID]);
  });

  it("does nothing without a desktop bridge", async () => {
    await expect(switchAccount(PERSONAL_ID, undefined)).resolves.toBeUndefined();
  });
});
