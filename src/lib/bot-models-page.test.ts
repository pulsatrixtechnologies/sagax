import { describe, expect, it } from "vitest";

import {
  botsWithSidebarSections,
  botModelWarning,
  bulkModelChangeSummary,
  formatBotBackups,
  formatBotModelSelection,
  groupBotsBySidebarSection,
  ownBotsForModelsPage,
  setSectionSelection,
  toggleBotSelection,
} from "./bot-models-page";
import type { PersonalSections } from "./personal-sections";

const member = {
  viewer: { role: "member" as const, operator: false, principalId: "p-me", email: "me@example.com", name: "Me", canCreateBots: true },
};

const bot = (over: Record<string, unknown> = {}) => ({
  id: "b1",
  name: "Scout",
  section: undefined as string | undefined,
  hidden: false,
  ownerUserId: "p-me",
  modelSelection: { instanceId: "grok", model: "grok-4" },
  threadId: "t1",
  ...over,
});

const instance = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  instanceId: id,
  displayName: name,
  driverKind: "grokAgent",
  models: { default: "m1", options: [{ id: "m1", label: "Model One" }, { id: "grok-4", label: "Grok 4" }, { id: "sonnet", label: "Sonnet" }] },
  snapshot: { state: "available" as const, authenticated: true },
  ...over,
}) as import("@/state/store").InstanceInfo;

describe("ownBotsForModelsPage", () => {
  it("keeps only the viewer's own visible bots", () => {
    const bots = [
      bot({ id: "mine" }),
      bot({ id: "theirs", ownerUserId: "p-other" }),
      bot({ id: "gone", hidden: true }),
      bot({ id: "machine", host: { kind: "machine" } }),
    ];
    expect(ownBotsForModelsPage(bots, member as never).map((row) => row.id)).toEqual(["mine"]);
  });

  it("keeps every bot for a solo operator", () => {
    expect(ownBotsForModelsPage([bot({ ownerUserId: "anyone" })], null).map((row) => row.id)).toEqual(["b1"]);
  });
});

describe("groupBotsBySidebarSection", () => {
  it("puts Unassigned first, then named sections", () => {
    const groups = groupBotsBySidebarSection([
      bot({ id: "a", name: "A", section: "Clients" }),
      bot({ id: "b", name: "B" }),
      bot({ id: "c", name: "C", section: "Clients" }),
      bot({ id: "d", name: "D", section: "Lab" }),
    ]);
    expect(groups.map((group) => [group.section, group.bots.map((row) => row.id)])).toEqual([
      ["", ["b"]],
      ["Clients", ["a", "c"]],
      ["Lab", ["d"]],
    ]);
  });
});

describe("botsWithSidebarSections", () => {
  it("uses the person's section assignment when present", () => {
    const personal: PersonalSections = { sections: [{ name: "Clients", items: ["bot:b1"] }] };
    expect(botsWithSidebarSections([bot()], personal)[0]!.section).toBe("Clients");
  });
});

describe("formatBotModelSelection", () => {
  const instances = [instance("grok", "Grok"), instance("claude", "Claude")];

  it("names the engine and model", () => {
    expect(formatBotModelSelection({ instanceId: "grok", model: "grok-4" }, instances)).toBe("Grok · Grok 4");
  });

  it("marks Auto and the last model when known", () => {
    expect(formatBotModelSelection({ instanceId: "claude", model: "sonnet", auto: true }, instances)).toBe("Auto (Claude · Sonnet)");
    expect(formatBotModelSelection({ instanceId: "claude", model: "", auto: true }, instances)).toBe("Auto");
  });
});

describe("formatBotBackups", () => {
  it("lists each backup", () => {
    expect(formatBotBackups(
      [{ instanceId: "claude", model: "sonnet" }],
      [instance("claude", "Claude")],
    )).toBe("Claude · Sonnet");
    expect(formatBotBackups(undefined, [])).toBe("");
  });
});

describe("botModelWarning", () => {
  it("flags a signed-out solo engine", () => {
    expect(botModelWarning(
      { modelSelection: { instanceId: "grok", model: "grok-4" } },
      [instance("grok", "Grok", { snapshot: { state: "available", authenticated: false } })],
    )).toBe("signedOut");
  });

  it("flags an expired organization engine", () => {
    expect(botModelWarning(
      { modelSelection: { instanceId: "grok", model: "grok-4" } },
      [instance("grok", "Grok")],
      {
        orgMode: true,
        myEngines: [{
          instanceId: "grok",
          driver: "grokAgent",
          displayName: "Grok",
          installed: true,
          subscription: { supported: true, signedIn: true, expired: true },
          myKey: false,
          orgKey: false,
          myTurns: "expired",
        }],
      },
    )).toBe("expired");
  });
});

describe("bulkModelChangeSummary", () => {
  it("one line per bot from and to", () => {
    const instances = [instance("grok", "Grok"), instance("claude", "Claude")];
    expect(bulkModelChangeSummary(
      [bot({ id: "a", name: "Atlas" }), bot({ id: "b", name: "Scout", modelSelection: { instanceId: "claude", model: "sonnet" } })],
      { instanceId: "claude", model: "sonnet" },
      instances,
    )).toEqual([
      { botId: "a", name: "Atlas", from: "Grok · Grok 4", to: "Claude · Sonnet" },
      { botId: "b", name: "Scout", from: "Claude · Sonnet", to: "Claude · Sonnet" },
    ]);
  });
});

describe("selection helpers", () => {
  it("toggles and sets a section", () => {
    expect([...toggleBotSelection(new Set(["a"]), "b")].sort()).toEqual(["a", "b"]);
    expect([...toggleBotSelection(new Set(["a", "b"]), "a")]).toEqual(["b"]);
    expect([...setSectionSelection(new Set(), ["a", "b"], true)].sort()).toEqual(["a", "b"]);
    expect([...setSectionSelection(new Set(["a", "b", "c"]), ["a", "b"], false)]).toEqual(["c"]);
  });
});
