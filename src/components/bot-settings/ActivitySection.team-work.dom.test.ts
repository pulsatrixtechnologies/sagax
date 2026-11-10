// @vitest-environment happy-dom
// #3462: the Coding section of an orchestrator bot lists its work (the team
// row, one row per piece of work, its steps, "Done today"); a bot without a
// team, a read not back yet and a failed first read draw today's section,
// the same DOM (ActivitySection.coding.dom.test.ts holds today's behaviour).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotActivityItem, BotActivityList } from "../../../shared/bot-activity";
import vectors from "../../../shared/team-work.vectors.json";
import { buildTeamWork, type TeamStepFacts, type TeamWork, type TeamWorkInput } from "../../../shared/team-work";

const dispatchMock = vi.fn();
const list: { value: BotActivityList } = { value: { items: [], subagents: [] } };
vi.mock("@/lib/use-bot-activity-feed", () => ({
  useBotActivityFeed: () => ({
    list: list.value, error: false, refresh: vi.fn(async () => {}), stop: vi.fn(), stopping: new Set(), now: NOW,
    live: { visible: () => true, fading: () => false }, deepLinked: null, clearDeepLink: vi.fn(),
  }),
}));
vi.mock("@/state/store-selector", () => ({ useStoreDispatch: () => dispatchMock, useStoreGetter: () => () => ({ routineRuns: [], bots: [], connected: true }) }));
vi.mock("@/lib/code-branches", () => ({ loadArchivedBranches: vi.fn(async () => []), setBranchArchived: vi.fn(async () => []) }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => false }));

const NOW = 1_000_000;
const coding: BotActivityItem = {
  id: "thread:th-9", kind: "session", botId: "orc", botName: "Lead", title: "Its own fix", status: "running",
  startedAt: NOW - 240_000, updatedAt: NOW, threadId: "th-9", coding: true, canStop: true,
};

const { setLocale } = await import("@/lib/i18n");
const { ActivitySectionBody, useBotCodingPanel } = await import("./ActivitySection");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const caseNamed = (name: string) => vectors.build.find((entry) => entry.name.startsWith(name))!;
/** The release of three steps, a finished merged fix, with names and threads. */
function teamWork(): TeamWork {
  const release = (caseNamed("sums of time").input.steps as unknown as TeamStepFacts[]).map((step, index) => ({ ...step, threadId: `t${index + 1}` }));
  const today = (caseNamed("done today").input.steps as unknown as TeamStepFacts[]).filter((step) => step.id === "h2").map((step) => ({ ...step, id: "m1", threadId: "t9" }));
  return buildTeamWork({
    ...(caseNamed("sums of time").input as unknown as TeamWorkInput),
    since: 0,
    steps: [...release, ...today],
    names: new Map([["dev", { name: "Builder", title: "Server builder" }], ["qa", { name: "Tester" }], ["rev", { name: "Checker" }]]),
  });
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  // the section's clock: the fixtures' now
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  setLocale("en");
  dispatchMock.mockReset();
  list.value = { items: [coding], subagents: [] };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const bot = { id: "orc", name: "Lead", title: "", color: "blue", threadId: "main", tasks: [] } as never;
function Body({ load }: { load: (botId: string, since: number) => Promise<TeamWork> }) {
  const panel = useBotCodingPanel(bot);
  return createElement(ActivitySectionBody, { bot, panel, codeWork: false, loadTeamWork: load });
}

async function draw(load: (botId: string, since: number) => Promise<TeamWork>): Promise<string> {
  await act(async () => { root.render(createElement(Body, { load })); });
  await act(async () => { await Promise.resolve(); });
  return host.innerHTML;
}

describe("the Coding section of an orchestrator", () => {
  it("a bot without a team keeps today's section, the same DOM", async () => {
    const pending = await draw(() => new Promise(() => {}));
    expect(host.querySelector('[data-activity-card="thread:th-9"]')).not.toBeNull();
    expect(host.querySelector("[data-team-work]")).toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    const empty = await draw(async () => ({ botId: "orc", at: NOW, team: [], live: [], doneToday: [] }));
    act(() => root.unmount());
    root = createRoot(host);
    const failed = await draw(async () => { throw new Error("offline"); });
    expect(empty).toBe(pending);
    expect(failed).toBe(pending);
  });

  it("a bot with a team draws the team row, the rows, the steps and Done today, then its own rows", async () => {
    const load = vi.fn(async (_botId: string, _since: number) => teamWork());
    await draw(load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]![0]).toBe("orc");
    const section = host.querySelector<HTMLElement>('[data-bot-settings-section="coding"][data-team-work]')!;
    expect(section).not.toBeNull();
    expect(section.querySelector("[data-activity-history='coding']")?.textContent).toBe("Coding");
    expect(section.querySelector("[data-team-count]")?.textContent).toBe("1 working now");
    expect([...section.querySelectorAll("[data-team-bot]")].map((tile) => tile.getAttribute("data-team-bot"))).toEqual(["dev", "qa", "rev"]);
    // #3462 review: the tile names the bot as its rows do, the title under it
    const dev = section.querySelector<HTMLElement>('[data-team-bot="dev"]')!;
    expect(dev.querySelector("[data-team-tile-label]")?.textContent).toBe("Builder");
    expect(dev.querySelector("[data-team-tile-title]")?.textContent).toBe("Server builder");
    expect(dev.querySelector("[title]")?.getAttribute("title")).toContain("Server builder");
    expect(section.querySelector('[data-team-bot="qa"] [data-team-tile-label]')?.textContent).toBe("Tester");
    expect(section.querySelector('[data-team-bot="qa"] [data-team-tile-title]')).toBeNull();
    const row = section.querySelector<HTMLElement>('[data-team-work-item="work:release"]')!;
    expect(row.querySelector("[data-team-work-name]")?.textContent).toBe("Release");
    expect(row.querySelector("[data-team-work-meta]")?.textContent).toBe("1/3 · 15 min · 12k tokens");
    expect(row.querySelector("[data-team-state-line]")?.textContent).toBe("Tester · last action 1 min ago");
    const toggle = row.querySelector<HTMLButtonElement>("[data-team-work-toggle]")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect([...row.querySelectorAll("[data-team-step-name]")].map((step) => step.textContent)).toEqual(["Build", "Test", "Review"]);
    expect(row.querySelector('[data-team-step="h1"] [data-team-done]')).not.toBeNull();
    const done = section.querySelector<HTMLElement>("[data-team-done-today]")!;
    expect(done.textContent).toContain("Done today · 1 merged");
    act(() => done.querySelector<HTMLButtonElement>("[data-team-done-toggle]")!.click());
    expect(done.querySelector('[data-team-work-item="step:m1"]')).not.toBeNull();
    // the bot's own coding rows stay, under the work view
    expect(section.querySelector('[data-activity-card="thread:th-9"]')).not.toBeNull();
    // no identifier on screen
    expect(section.textContent).not.toMatch(/\b(h[123]|m1|t[129]|orc|dev|qa|rev)\b/);
  });

  it("a click on a step opens that team bot's coding chat; the orchestrator stays selected", async () => {
    await draw(async () => teamWork());
    act(() => host.querySelector<HTMLButtonElement>('[data-team-work-item="work:release"] [data-team-work-toggle]')!.click());
    act(() => host.querySelector<HTMLButtonElement>('[data-team-step-open="t2"]')!.click());
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const action = dispatchMock.mock.calls[0]![0];
    expect(action).toMatchObject({ type: "openCodingChat", target: { botId: "qa", itemId: "thread:t2", threadId: "t2", step: { orchestratorId: "orc", name: "Test", work: "Release", index: 2, total: 3 } } });
    expect(action.target.seed).toMatchObject({ title: "Test", status: "running", botId: "qa" });
    // a tile opens its step too
    // (its newest step: the merged fix of today)
    act(() => host.querySelector<HTMLButtonElement>('[data-team-bot-open="t9"]')!.click());
    expect(dispatchMock.mock.calls[1]![0]).toMatchObject({ target: { botId: "dev", threadId: "t9", step: { name: "Today", index: 1, total: 1 } } });
  });
});
