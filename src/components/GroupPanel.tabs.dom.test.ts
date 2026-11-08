// @vitest-environment happy-dom
// 2026-11-03 (the owner): the group panel reads like a bot's. Details carries the
// bot's sections for the group (its routines among them); Members lists the
// people, the bots (the lead set on a bot's row) and Leave group, with every
// other setting folded under Advanced; there is no Advanced tab.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot, Group } from "@/state/store";
import type { Routine } from "../../shared/routines";

const fixture = vi.hoisted(() => ({
  api: vi.fn(),
  dispatch: vi.fn(),
  state: {} as Record<string, unknown>,
}));

vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  api: fixture.api,
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch, flushBotPatches: () => Promise.resolve() }),
  useStoreOptional: () => ({ state: fixture.state, dispatch: fixture.dispatch }),
}));
vi.mock("./DesktopCapabilities", async (original) => ({
  ...await original<typeof import("./DesktopCapabilities")>(),
  useCaptionChrome: () => ({ padClass: "", dragProps: {} }),
  useMacInsetChrome: () => ({ macInset: false, browser: true }),
}));
vi.mock("./ExportTranscriptMenu", () => ({ ExportTranscriptMenu: () => null }));
// Per-bot feeds read the server; their own tests cover them.
vi.mock("./bot-settings/ActivitySection", () => ({ ActivitySection: ({ bot }: { bot: Bot }) => createElement("p", { "data-activity-of": bot.id }) }));
vi.mock("./remote-session/RemoteSessionsSection", () => ({ RemoteSessionsSection: () => null }));
vi.mock("./ComputerPanel", () => ({ ComputerPanel: ({ bot }: { bot: Bot }) => createElement("p", { "data-computer-of": bot.id }) }));

const { setLocale } = await import("@/lib/i18n");
const { setInterfaceMode } = await import("@/lib/interface-mode");
const { GroupPanel } = await import("./GroupPanel");
const { ChannelMembers } = await import("./ChannelMembers");

const bot = (id: string, name: string): Bot =>
  ({ id, threadId: `t-${id}`, name, title: "", description: "", color: "green", unread: false, messages: [], tasks: [], computer: "local", modelSelection: { instanceId: "i", model: "m" } }) as unknown as Bot;
const osprey = bot("osprey", "Osprey");
const wren = bot("wren", "Wren");
const group = {
  id: "ops", threadId: "t-ops", name: "Ops", bulletin: "Be brief.", memberIds: ["osprey", "wren"], humanIds: [], messages: [],
  defaultResponder: { kind: "member", botId: "osprey" }, createdAt: 1, unread: false,
} as unknown as Group;
const routine = (id: string, name: string, extra: Partial<Routine>): Routine => ({
  id, name, prompt: "Check the queue", target: "bot", botId: "osprey", runOn: "maus", enabled: true,
  schedule: { type: "cron", expression: "0 9 * * 1-5", timeZone: "UTC" }, durationMinutes: 30, nextRunAt: null, createdAt: 1, updatedAt: 1,
  ...extra,
} as Routine);

let host: HTMLDivElement;
let root: Root;
const render = (props: Partial<Parameters<typeof GroupPanel>[0]> = {}) => flushSync(() => root.render(createElement(GroupPanel, {
  group,
  members: [osprey, wren],
  canEdit: true,
  roster: createElement("div", { "data-roster": "" }, "Osprey, Wren"),
  advanced: createElement("p", { "data-responder-select": "" }, "responder"),
  onLeave: vi.fn(),
  ...props,
})));
const tabs = () => [...host.querySelectorAll<HTMLElement>('[role="tab"]')].map((tab) => tab.dataset.panelTab);
const openTab = (id: string) => flushSync(() => host.querySelector<HTMLElement>(`[data-panel-tab="${id}"]`)!.click());

beforeEach(async () => {
  await setLocale("en");
  setInterfaceMode("advanced");
  fixture.api.mockReset();
  fixture.api.mockResolvedValue({ tasks: [] });
  fixture.dispatch.mockReset();
  fixture.state = {
    config: null,
    bots: [osprey, wren],
    groups: [group],
    routines: [
      routine("r1", "Weekly ops review", { target: "room-goal", groupId: "ops" }),
      routine("r2", "Post the digest here", { resultsThreadId: "t-ops" }),
      routine("r3", "Someone else's routine", { botId: "wren" }),
    ],
    routineRuns: [],
    routinesLoadState: "ready",
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe("group panel tabs", () => {
  it("has Activity (details), Members, Library and no Advanced or Computer tab", () => {
    render();
    // Instructions and Memory are hidden for now; Computer is a Details section.
    expect(tabs()).toEqual(["details", "members", "library"]);
    expect(host.querySelector('[data-panel-tab="advanced"]')).toBeNull();
  });

  it("keeps no Advanced tab for a remote client either", () => {
    render({ advanced: null });
    expect(tabs()).not.toContain("advanced");
  });

  it("keeps the same tabs in Simple mode", () => {
    setInterfaceMode("simple");
    render();
    expect(tabs()).toEqual(["details", "members", "library"]);
  });
});

describe("group panel Details", () => {
  it("shows the group's routines: its team goals and the routines that post in it", async () => {
    render();
    // Details loads on demand (it is off the launch bundle).
    await vi.waitFor(() => expect(host.querySelector("[data-group-routines]")).not.toBeNull(), { timeout: 15_000 });
    const section = host.querySelector("[data-group-routines]")!;
    expect(section).not.toBeNull();
    expect(section.textContent).toContain("Weekly ops review");
    expect(section.textContent).toContain("Post the digest here");
    expect(section.textContent).not.toContain("Someone else's routine");
  });

  it("draws each own bot's activity, as a bot's Details does", async () => {
    render();
    await vi.waitFor(() => expect(host.querySelector('[data-activity-of="osprey"]')).not.toBeNull(), { timeout: 15_000 });
    expect(host.querySelector('[data-activity-of="wren"]')).not.toBeNull();
  });

  it("lays Details out in the bot panel's order: Upcoming, Suggested, Computer", async () => {
    render();
    await vi.waitFor(() => expect(host.querySelector('[data-group-details] [data-bot-settings-section="computer"]')).not.toBeNull(), { timeout: 15_000 });
    const order = [...host.querySelectorAll("[data-group-details] [data-bot-settings-section]")].map((el) => el.getAttribute("data-bot-settings-section"));
    expect(order.slice(0, 3)).toEqual(["routines", "suggestions", "computer"]);
    const rows = [...host.querySelectorAll('[data-bot-settings-section="suggestions"] [data-suggestion]')].map((el) => el.getAttribute("data-suggestion"));
    expect(rows).toEqual(expect.arrayContaining(["slack", "meeting"]));
  });

  it("does not show the roster or Leave group on Details", () => {
    render();
    expect(host.querySelector("[data-roster]")).toBeNull();
    expect(host.querySelector("[data-leave-group]")).toBeNull();
  });
});

describe("group panel Members", () => {
  it("lists the roster and Leave group", () => {
    render();
    openTab("members");
    expect(host.querySelector("[data-roster]")?.textContent).toBe("Osprey, Wren");
    expect(host.querySelector("[data-leave-group]")?.textContent).toBe("Leave group");
  });

  it("folds Advanced by default and opens it in place", () => {
    render();
    openTab("members");
    const toggle = host.querySelector<HTMLButtonElement>("[data-group-advanced-toggle]")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector("[data-responder-select]")).toBeNull();
    flushSync(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("[data-responder-select]")).not.toBeNull();
  });

  it("has no Leave group when the viewer cannot leave", () => {
    render({ onLeave: undefined });
    openTab("members");
    expect(host.querySelector("[data-leave-group]")).toBeNull();
  });
});

describe("lead on a bot's row", () => {
  const renderRoster = (onSetLead?: (id: string) => void) => flushSync(() => root.render(createElement(ChannelMembers, {
    part: "bots",
    humans: [],
    bots: [{ id: "osprey", name: "Osprey" }, { id: "wren", name: "Wren" }],
    canAddHuman: false,
    canAddBot: true,
    onAddBot: vi.fn(),
    onRemoveBot: vi.fn(),
    leadBotId: "osprey",
    ...(onSetLead ? { onSetLead } : {}),
  })));

  it("marks the lead and sets another bot as lead from its row", () => {
    const onSetLead = vi.fn();
    renderRoster(onSetLead);
    const row = (name: string) => [...host.querySelectorAll<HTMLElement>("[data-roster-bot]")].find((li) => li.textContent?.includes(name))!;
    expect(row("Osprey").querySelector("[data-lead-badge]")?.textContent).toBe("Lead");
    expect(row("Osprey").querySelector("[data-make-lead]")).toBeNull();
    expect(row("Wren").querySelector("[data-lead-badge]")).toBeNull();
    const make = row("Wren").querySelector<HTMLButtonElement>("[data-make-lead]")!;
    expect(make.getAttribute("aria-label")).toBe("Make Wren the lead");
    flushSync(() => make.click());
    expect(onSetLead).toHaveBeenCalledWith("wren");
  });

  it("shows the lead but offers no change to someone who cannot set it", () => {
    renderRoster();
    expect(host.querySelector("[data-lead-badge]")).not.toBeNull();
    expect(host.querySelector("[data-make-lead]")).toBeNull();
  });
});
