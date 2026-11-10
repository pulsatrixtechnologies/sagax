// @vitest-environment happy-dom
// #3462: the work view of an orchestrator's Coding section, with its data
// hook (src/lib/use-team-work.ts): the mark of each state, ages that advance
// on the clock with no request, the stream's events of a step's thread, one
// read per burst of frames and per lost frames, no live mark while the
// stream is down, what is and is not a button, "N more" past 8 steps, the
// keyboard path.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import vectors from "../../../shared/team-work.vectors.json";
import { buildTeamWork, type TeamStepFacts, type TeamWork, type TeamWorkInput } from "../../../shared/team-work";
import type { ServerFrame } from "../../../shared/wire";

const NOW = 1_000_000;
const { setLocale } = await import("@/lib/i18n");
const { TeamWorkSection } = await import("./TeamWorkSection");
const { useTeamWork, TEAM_WORK_DEBOUNCE_MS } = await import("@/lib/use-team-work");
const { publishLiveFrame, publishMissedFrames } = await import("@/lib/live-events");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NAMES = new Map([["dev", { name: "Builder" }], ["qa", { name: "Tester" }], ["rev", { name: "Checker" }]]);
const caseNamed = (name: string) => vectors.build.find((entry) => entry.name.startsWith(name))!;
const threaded = (name: string) => (caseNamed(name).input.steps as unknown as TeamStepFacts[]).map((step, index) => ({ ...step, threadId: `t${index + 1}` }));

/** One named piece of work: dev done, rev working (last action 20 s ago). */
function oneName(): TeamWork {
  return buildTeamWork({ ...(caseNamed("one name").input as unknown as TeamWorkInput), steps: threaded("one name"), names: NAMES });
}

let host: HTMLDivElement;
let root: Root;
let onOpenStep: ReturnType<typeof vi.fn<(step: unknown) => void>>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  setLocale("en");
  onOpenStep = vi.fn<(step: unknown) => void>();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function Harness({ load, streaming = true, stepsShown }: { load: (botId: string, since: number) => Promise<TeamWork>; streaming?: boolean; stepsShown?: number }) {
  const view = useTeamWork("orc", { load });
  if (!view.work) return null;
  return createElement(TeamWorkSection, { work: view.work, now: view.now, streaming, bots: [], onOpenStep, onOpenHistory: () => {}, ...(stepsShown ? { stepsShown } : {}) });
}

async function draw(load: (botId: string, since: number) => Promise<TeamWork>, props: { streaming?: boolean; stepsShown?: number } = {}) {
  await act(async () => { root.render(createElement(Harness, { load, ...props })); });
  await act(async () => { await Promise.resolve(); });
}

const line = () => host.querySelector('[data-team-work-item="work:login fix"] [data-team-state-line]')?.textContent;
const runtime = (threadId: string, type: string, extra: Record<string, unknown> = {}) => ({ kind: "runtime", event: { eventId: `e${Math.random()}`, provider: "claude", threadId, createdAt: new Date(Date.now()).toISOString(), type, ...extra } }) as unknown as ServerFrame;

describe("the work view", () => {
  it("draws the mark of each state: accent working, warning silent, none waiting, a dimmed face idle", async () => {
    const work = buildTeamWork({
      orchestratorId: "orc", now: NOW, since: 0, names: new Map([...NAMES, ["ux", { name: "Painter" }]]),
      steps: [
        { id: "a", botId: "dev", requesterBotId: "orc", threadId: "ta", title: "Code", mode: "work", status: "running", createdAt: 0, startedAt: 0, turn: { startedAt: 0, lastActionAt: NOW - 40_000 }, coding: true },
        { id: "b", botId: "qa", requesterBotId: "orc", threadId: "tb", title: "Test", mode: "work", status: "running", createdAt: 1, startedAt: 1, turn: { startedAt: 1, lastActionAt: NOW - 6 * 60_000 }, coding: true },
        { id: "c", botId: "rev", requesterBotId: "orc", threadId: "tc", title: "Review", mode: "work", status: "queued", createdAt: 2, coding: true },
        { id: "d", botId: "ux", requesterBotId: "orc", threadId: "td", title: "Paint", mode: "work", status: "completed", createdAt: 3, startedAt: 3, finishedAt: 10, coding: true },
      ],
    });
    await draw(async () => work);
    const mark = (botId: string) => host.querySelector(`[data-team-bot="${botId}"] [data-team-mark]`)?.getAttribute("data-team-mark") ?? null;
    expect(mark("dev")).toBe("working");
    expect(mark("qa")).toBe("silent");
    expect(mark("rev")).toBeNull();
    expect(mark("ux")).toBeNull();
    expect(host.querySelector('[data-team-bot="dev"] [data-team-face]')?.getAttribute("data-team-face")).toBe("lit");
    expect(host.querySelector('[data-team-bot="ux"] [data-team-face]')?.getAttribute("data-team-face")).toBe("dim");
    expect(host.querySelector('[data-team-bot="qa"] button')?.getAttribute("aria-label")).toBe("Tester, silent for 6 min");
    expect(host.querySelector("[data-team-count]")?.textContent).toBe("1 working now · 1 silent");
  });

  it("the ages advance on the clock with no request, and turn silent at 3 minutes", async () => {
    const load = vi.fn(async () => oneName());
    await draw(load);
    expect(line()).toBe("Checker · last action 20 s ago");
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(line()).toBe("Checker · last action 50 s ago");
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(160_000); await Promise.resolve(); });
    expect(line()).toBe("Checker · silent for 3 min");
    expect(host.querySelector('[data-team-bot="rev"] [data-team-mark]')?.getAttribute("data-team-mark")).toBe("silent");
    // only the safety read, once a minute while a step is open
    expect(load).toHaveBeenCalledTimes(1 + 3);
  });

  it("a runtime event of a step's thread resets its age; another thread's does nothing", async () => {
    const load = vi.fn(async () => oneName());
    await draw(load);
    await act(async () => { vi.advanceTimersByTime(200_000); await Promise.resolve(); });
    expect(line()).toBe("Checker · silent for 3 min");
    const reads = load.mock.calls.length;
    act(() => { publishLiveFrame(runtime("elsewhere", "content.delta", { streamKind: "assistant_text", delta: "x" })); vi.advanceTimersByTime(1_000); });
    expect(line()).toBe("Checker · silent for 3 min");
    act(() => { publishLiveFrame(runtime("t2", "content.delta", { streamKind: "assistant_text", delta: "x" })); vi.advanceTimersByTime(1_000); });
    expect(line()).toBe("Checker · last action 1 s ago");
    // the event itself asks nothing of the server
    expect(load).toHaveBeenCalledTimes(reads);
  });

  it("a burst of team frames is one read; lost frames are one read", async () => {
    const load = vi.fn(async () => oneName());
    await draw(load);
    act(() => {
      for (let index = 0; index < 5; index++) publishLiveFrame({ kind: "team.work", botId: "orc" } as unknown as ServerFrame);
      publishLiveFrame({ kind: "team.work", botId: "someone-else" } as unknown as ServerFrame);
    });
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(TEAM_WORK_DEBOUNCE_MS); await Promise.resolve(); });
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => { publishMissedFrames(); await Promise.resolve(); });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("while the stream is down no live mark and no count is drawn; the rows stay", async () => {
    await draw(async () => oneName(), { streaming: false });
    expect(host.querySelector("[data-team-mark]")).toBeNull();
    expect(host.querySelector("[data-team-count]")).toBeNull();
    expect(host.querySelector('[data-team-work-item="work:login fix"]')).not.toBeNull();
  });

  it("a step to come and a step with no thread are not buttons", async () => {
    const work = buildTeamWork({ ...(caseNamed("one name").input as unknown as TeamWorkInput), names: NAMES });
    work.live[0]!.toCome = [{ name: "Merge", botId: "dev" }];
    await draw(async () => work);
    act(() => host.querySelector<HTMLButtonElement>("[data-team-work-toggle]")!.click());
    expect(host.querySelectorAll("[data-team-step]")).toHaveLength(2);
    expect(host.querySelector("[data-team-step] button")).toBeNull();
    const toCome = host.querySelector("[data-team-step-to-come]")!;
    expect(toCome.querySelector("button")).toBeNull();
    expect(toCome.textContent).toContain("Builder · to come");
    // no thread: the tile is no button either
    expect(host.querySelector('[data-team-bot="rev"] button')).toBeNull();
  });

  it("past 8 steps, N more shows the rest", async () => {
    const steps: TeamStepFacts[] = Array.from({ length: 11 }, (_, index) => ({
      id: `s${index}`, botId: index % 2 ? "dev" : "qa", requesterBotId: "orc", threadId: `ts${index}`, title: `Step ${index + 1}`, work: "Big", mode: "work",
      status: index < 10 ? "completed" : "running", createdAt: index, startedAt: index, ...(index < 10 ? { finishedAt: index + 1 } : { turn: { startedAt: index, lastActionAt: NOW } }), coding: true,
    }));
    await draw(async () => buildTeamWork({ orchestratorId: "orc", now: NOW, since: 0, steps, names: NAMES }));
    act(() => host.querySelector<HTMLButtonElement>("[data-team-work-toggle]")!.click());
    expect(host.querySelectorAll("[data-team-step]")).toHaveLength(8);
    const more = host.querySelector<HTMLButtonElement>("[data-team-steps-more]")!;
    expect(more.textContent).toBe("↓ 3 more");
    act(() => more.click());
    expect(host.querySelectorAll("[data-team-step]")).toHaveLength(11);
    expect(host.querySelector("[data-team-steps-more]")).toBeNull();
  });

  it("the keyboard path: every control is a native button, in reading order, and opens the step", async () => {
    await draw(async () => oneName());
    const toggle = host.querySelector<HTMLButtonElement>("[data-team-work-toggle]")!;
    act(() => toggle.click());
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.every((button) => button.type === "button" && !button.disabled && button.tabIndex >= 0)).toBe(true);
    const order = buttons.map((button) => button.getAttribute("data-team-bot-open") ? "tile" : button.hasAttribute("data-team-work-toggle") ? "work" : button.getAttribute("data-team-step-open") ? "step" : "other");
    expect(order.indexOf("tile")).toBeLessThan(order.indexOf("work"));
    expect(order.indexOf("work")).toBeLessThan(order.indexOf("step"));
    const step = host.querySelector<HTMLButtonElement>('[data-team-step-open="t2"]')!;
    step.focus();
    expect(document.activeElement).toBe(step);
    expect(step.getAttribute("aria-label")).toBe("Open the coding chat of Checker for Review it");
    act(() => step.click());
    expect(onOpenStep).toHaveBeenCalledWith(expect.objectContaining({ botId: "rev", threadId: "t2", name: "Review it", work: "Login fix", index: 2, total: 2 }));
  });
});
