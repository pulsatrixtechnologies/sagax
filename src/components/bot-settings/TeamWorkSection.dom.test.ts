// @vitest-environment happy-dom
// #3462, #3575: the work view of an orchestrator's Coding section, with its
// data hook (src/lib/use-team-work.ts): no team grid, a work row drawn by the
// existing Coding row, the status icon of each state, ages that advance on
// the clock with no request, the stream's events of a step's thread, one
// read per burst of frames and per lost frames, no silent warning while the
// stream is down, the spend in the unfolded detail once, what is and is not
// a button, "N more" past 8 steps, the keyboard path, French and English.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import vectors from "../../../shared/team-work.vectors.json";
import { buildTeamWork, type TeamStepFacts, type TeamWork, type TeamWorkInput } from "../../../shared/team-work";
import type { ServerFrame } from "../../../shared/wire";
import type { BotActivityItem } from "../../../shared/bot-activity";

const NOW = 1_000_000;
const { setLocale } = await import("@/lib/i18n");
const { TeamWorkSection } = await import("./TeamWorkSection");
const { AgentRows } = await import("./AgentRows");
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

/** One of the bot's own coding rows, as the panel lists it. */
const OWN: BotActivityItem = { id: "thread:own", kind: "session", botId: "orc", botName: "Lead", title: "Its own fix", status: "running", startedAt: NOW - 60_000, updatedAt: NOW, threadId: "own", coding: true };

function Harness({ load, streaming = true, stepsShown, own = false }: { load: (botId: string, since: number) => Promise<TeamWork>; streaming?: boolean; stepsShown?: number; own?: boolean }) {
  const view = useTeamWork("orc", { load });
  if (!view.work) return null;
  return createElement(TeamWorkSection, {
    work: view.work, now: view.now, streaming, bots: [], onOpenStep, onOpenHistory: () => {}, ...(stepsShown ? { stepsShown } : {}),
    ...(own ? { children: (lead: ReactNode) => createElement(AgentRows, { lead, items: [OWN], onOpen: () => {} }) } : {}),
  });
}

async function draw(load: (botId: string, since: number) => Promise<TeamWork>, props: { streaming?: boolean; stepsShown?: number; own?: boolean } = {}) {
  await act(async () => { root.render(createElement(Harness, { load, ...props })); });
  await act(async () => { await Promise.resolve(); });
}

const line = () => host.querySelector('[data-team-work-item="work:login fix"] [data-team-line]')?.textContent;
const icon = (key: string) => host.querySelector(`[data-team-work-item="${key}"]`)?.getAttribute("data-coding-state") ?? null;
const toggle = (key = "work:login fix") => host.querySelector<HTMLButtonElement>(`[data-team-work-item="${key}"] [data-coding-open]`)!;

/** An element's shape: its tag and classes, and its children's, down the
 * tree; the grey line's own words are the only part left out. */
function shape(element: Element): string {
  if (element.hasAttribute("data-coding-subtitle")) return `${element.tagName}.${element.className}[line]`;
  return `${element.tagName}.${element.getAttribute("class") ?? ""}(${[...element.children].map(shape).join(",")})`;
}
const runtime = (threadId: string, type: string, extra: Record<string, unknown> = {}) => ({ kind: "runtime", event: { eventId: `e${Math.random()}`, provider: "claude", threadId, createdAt: new Date(Date.now()).toISOString(), type, ...extra } }) as unknown as ServerFrame;

describe("the work view", () => {
  it("holds no team grid: no tile, no mark, no bar, no figures on the right", async () => {
    await draw(async () => oneName());
    expect(host.querySelector("[data-team-row]")).toBeNull();
    expect(host.querySelector("[data-team-bot]")).toBeNull();
    expect(host.querySelector("[data-team-mark]")).toBeNull();
    expect(host.querySelector("[data-team-work-bar]")).toBeNull();
    expect(host.querySelector("[data-team-work-meta]")).toBeNull();
    expect(host.querySelectorAll('[data-bot-settings-section="coding"] > ul')).toHaveLength(1);
  });

  it("a work row is the existing Coding row: same component, same structure, in the same card", async () => {
    await draw(async () => oneName(), { own: true });
    const work = host.querySelector<HTMLElement>('[data-team-work-item="work:login fix"]')!;
    const own = host.querySelector<HTMLElement>('[data-activity-card="thread:own"]')!;
    expect(work.parentElement).toBe(own.parentElement);
    for (const row of [work, own]) {
      expect(row.tagName).toBe("LI");
      expect(row.hasAttribute("data-agent-row")).toBe(true);
    }
    expect(shape(work)).toBe(shape(own));
    expect(work.querySelector("[data-agent-title]")?.textContent).toBe("Login fix");
    expect(line()).toBe("Checker · 1/2 · 20 s ago");
    expect(work.querySelector("[data-coding-subtitle] [data-team-face]")?.getAttribute("data-team-face")).toBe("rev");
    // unfolded, a step is the same row too, one level in
    act(() => toggle().click());
    const step = host.querySelector<HTMLElement>('[data-team-step="h2"]') ?? host.querySelector<HTMLElement>("[data-team-step]")!;
    expect(step.parentElement).toBe(own.parentElement);
    expect(step.hasAttribute("data-agent-row")).toBe(true);
    expect(shape(step).replace(" pl-11", "")).toBe(shape(own));
  });

  it("draws the status icon of the existing rows for each state: running, warning while silent, waiting, done", async () => {
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
    expect(icon("step:a")).toBe("running");
    expect(icon("step:b")).toBe("blocked");
    expect(host.querySelector('[data-team-work-item="step:b"] [data-activity-icon="blocked"]')?.getAttribute("class")).toContain("text-warning");
    expect(icon("step:c")).toBe("waiting");
    act(() => host.querySelector<HTMLButtonElement>("[data-team-done-today] [data-coding-open]")!.click());
    expect(icon("step:d")).toBe("finished");
    expect(host.querySelector('[data-team-work-item="step:b"] [data-team-line]')?.textContent).toBe("Tester · 0/1 · silent for 6 min");
    expect(host.querySelector("[data-team-count]")?.textContent).toBe("1 working now · 1 silent");
  });

  it("the ages advance on the clock with no request, and turn silent at 3 minutes", async () => {
    const load = vi.fn(async () => oneName());
    await draw(load);
    expect(line()).toBe("Checker · 1/2 · 20 s ago");
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(line()).toBe("Checker · 1/2 · 50 s ago");
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(160_000); await Promise.resolve(); });
    expect(line()).toBe("Checker · 1/2 · silent for 3 min");
    expect(icon("work:login fix")).toBe("blocked");
    // only the safety read, once a minute while a step is open
    expect(load).toHaveBeenCalledTimes(1 + 3);
  });

  it("a runtime event of a step's thread resets its age; another thread's does nothing", async () => {
    const load = vi.fn(async () => oneName());
    await draw(load);
    await act(async () => { vi.advanceTimersByTime(200_000); await Promise.resolve(); });
    expect(line()).toBe("Checker · 1/2 · silent for 3 min");
    const reads = load.mock.calls.length;
    act(() => { publishLiveFrame(runtime("elsewhere", "content.delta", { streamKind: "assistant_text", delta: "x" })); vi.advanceTimersByTime(1_000); });
    expect(line()).toBe("Checker · 1/2 · silent for 3 min");
    act(() => { publishLiveFrame(runtime("t2", "content.delta", { streamKind: "assistant_text", delta: "x" })); vi.advanceTimersByTime(1_000); });
    expect(line()).toBe("Checker · 1/2 · 1 s ago");
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

  it("while the stream is down no silent warning and no count is drawn; the rows stay", async () => {
    await draw(async () => oneName(), { streaming: false });
    await act(async () => { vi.advanceTimersByTime(200_000); await Promise.resolve(); });
    expect(icon("work:login fix")).toBe("running");
    expect(host.querySelector("[data-team-count]")).toBeNull();
    expect(host.querySelector('[data-team-work-item="work:login fix"]')).not.toBeNull();
  });

  it("a step to come and a step with no thread are not buttons", async () => {
    const work = buildTeamWork({ ...(caseNamed("one name").input as unknown as TeamWorkInput), names: NAMES });
    work.live[0]!.toCome = [{ name: "Merge", botId: "dev" }];
    await draw(async () => work);
    act(() => toggle().click());
    expect(host.querySelectorAll("[data-team-step]")).toHaveLength(2);
    expect(host.querySelector("[data-team-step] button:not(:disabled)")).toBeNull();
    expect(host.querySelector("[data-team-step] [data-coding-chevron]")).toBeNull();
    const toCome = host.querySelector("[data-team-step-to-come]")!;
    expect(toCome.querySelector("button:not(:disabled)")).toBeNull();
    expect(toCome.getAttribute("data-coding-state")).toBe("queued");
    expect(toCome.querySelector("[data-team-line]")?.textContent).toBe("Builder · to come");
  });

  it("past 8 steps, N more shows the rest", async () => {
    const steps: TeamStepFacts[] = Array.from({ length: 11 }, (_, index) => ({
      id: `s${index}`, botId: index % 2 ? "dev" : "qa", requesterBotId: "orc", threadId: `ts${index}`, title: `Step ${index + 1}`, work: "Big", mode: "work",
      status: index < 10 ? "completed" : "running", createdAt: index, startedAt: index, ...(index < 10 ? { finishedAt: index + 1 } : { turn: { startedAt: index, lastActionAt: NOW } }), coding: true,
    }));
    await draw(async () => buildTeamWork({ orchestratorId: "orc", now: NOW, since: 0, steps, names: NAMES }));
    act(() => toggle("work:big").click());
    expect(host.querySelectorAll("[data-team-step]")).toHaveLength(8);
    const more = host.querySelector<HTMLButtonElement>("[data-team-steps-more]")!;
    expect(more.textContent).toBe("↓ 3 more");
    act(() => more.click());
    expect(host.querySelectorAll("[data-team-step]")).toHaveLength(11);
    expect(host.querySelector("[data-team-steps-more]")).toBeNull();
  });

  it("the unfolded detail holds the duration and the tokens once", async () => {
    await draw(async () => oneName());
    const section = host.querySelector<HTMLElement>("[data-team-work]")!;
    expect(section.textContent).not.toContain("tokens");
    act(() => toggle().click());
    const spend = section.querySelectorAll("[data-team-work-spend]");
    expect(spend).toHaveLength(1);
    expect(spend[0]!.getAttribute("class")).toContain("text-ink-secondary");
    expect(section.textContent!.split("tokens").length - 1).toBe(spend[0]!.textContent!.split("tokens").length - 1);
    const duration = spend[0]!.textContent!.split(" · ")[0]!;
    expect(section.querySelector("[data-team-work-item] [data-team-line]")?.textContent).not.toContain(duration);
  });

  it("speaks French and English", async () => {
    await draw(async () => oneName());
    act(() => toggle().click());
    const en = host.querySelector("[data-team-work]")!.textContent!;
    expect(line()).toBe("Checker · 1/2 · 20 s ago");
    act(() => root.unmount());
    root = createRoot(host);
    setLocale("fr");
    await draw(async () => oneName());
    act(() => toggle().click());
    expect(line()).toBe("Checker · 1/2 · il y a 20 s");
    const fr = host.querySelector("[data-team-work]")!.textContent!;
    expect(fr).not.toBe(en);
    for (const text of [en, fr]) expect(text).not.toMatch(/[–—]/);
  });

  it("never cuts the state and its time: the name gives way first, then the last action, never an orphan separator (#3613)", async () => {
    const LONG = "Reviewer of every pull request in the whole team";
    const DOING = "Running the whole test suite of the server package";
    const work = () => buildTeamWork({
      orchestratorId: "orc", now: NOW, since: 0, names: new Map([["qa", { name: LONG }], ["dev", { name: "Server" }], ["chk", { name: "Tester" }]]),
      steps: [
        { id: "q", botId: "qa", requesterBotId: "orc", threadId: "tq", title: "Quiet", mode: "work", status: "running", createdAt: 0, startedAt: 0, turn: { startedAt: 0, lastActionAt: NOW - 6 * 60_000 }, coding: true },
        { id: "t", botId: "dev", requesterBotId: "orc", threadId: "tt", title: "Tool", mode: "work", status: "running", createdAt: 1, startedAt: 1, turn: { startedAt: 1, lastActionAt: NOW - 5_000, toolSince: NOW - 2 * 60_000 }, doing: DOING, coding: true },
        { id: "c", botId: "chk", requesterBotId: "orc", threadId: "tc", title: "Short", mode: "work", status: "running", createdAt: 2, startedAt: 2, turn: { startedAt: 2, lastActionAt: NOW - 2 * 3_600_000 }, coding: true },
      ],
    });
    // a layout: every character 7 px wide, the line `room` px wide
    let room = 0;
    const CHAR = 7;
    const box = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const width = this.hasAttribute("data-team-line") ? room : this.hasAttribute("data-team-probe") ? [...(this.textContent ?? "")].length * CHAR : 0;
      return { x: 0, y: 0, top: 0, left: 0, bottom: 20, right: width, width, height: 20, toJSON: () => ({}) } as DOMRect;
    });
    const cases = [
      ["en", { q: "silent for 6 min", t: "2 min", c: "silent for 2 h" }],
      ["fr", { q: "silencieux depuis 6 min", t: "2 min", c: "silencieux depuis 2 h" }],
    ] as const;
    try {
      for (const [locale, last] of cases) for (const width of [200, 240, 320, 600]) {
        setLocale(locale);
        room = width;
        act(() => root.unmount());
        root = createRoot(host);
        await draw(async () => work());
        for (const [key, name] of [["q", LONG], ["t", "Server"], ["c", "Tester"]] as const) {
          const row = host.querySelector<HTMLElement>(`[data-team-work-item="step:${key}"]`)!;
          const where = `${locale} ${width}px ${key}`;
          const drawn = [...row.querySelector("[data-team-line]")!.children].filter((child) => !child.hasAttribute("data-team-probe")) as HTMLElement[];
          const text = drawn.map((child) => child.textContent).join("");
          // the line fits its row; it never starts or ends with a separator, never two in a row
          expect([...text].length * CHAR, where).toBeLessThanOrEqual(width);
          expect(drawn[0]?.hasAttribute("data-team-separator"), where).toBe(false);
          expect(drawn.at(-1)?.hasAttribute("data-team-separator"), where).toBe(false);
          drawn.forEach((child, index) => expect(index % 2 === 1, `${where}: part and separator alternate`).toBe(child.hasAttribute("data-team-separator")));
          // a drawn name or action is whole, or a start of a few characters ended by an ellipsis right against its separator
          for (const [part, full] of [["who", name], ["action", DOING]] as const) {
            const cut = row.querySelector<HTMLElement>(`[data-team-line] [data-team-part="${part}"]`);
            if (!cut || cut.textContent === full) continue;
            const kept = cut.textContent!.slice(0, -1);
            expect(cut.textContent!.endsWith("…"), where).toBe(true);
            expect([...kept].length, where).toBeGreaterThanOrEqual(3);
            expect(full.startsWith(kept) && kept === kept.trimEnd(), where).toBe(true);
            expect(cut.nextElementSibling?.hasAttribute("data-team-separator"), where).toBe(true);
          }
          // the state with its time: whole, last
          expect(drawn.at(-1)?.textContent, where).toBe(last[key]);
          expect(drawn.at(-1)?.dataset.teamPart, where).toBe("whole");
          // the whole line stays in the row's tooltip
          expect(row.querySelector("[data-coding-subtitle]")?.getAttribute("title"), where).toBe(`${name} · 0/1 · ${key === "t" ? `${DOING} · 2 min` : last[key]}`);
        }
        // the narrow panel: the long name gives way first (cut or aside), then the last action
        if (width === 240) {
          expect(host.querySelector('[data-team-work-item="step:q"] [data-team-part="who"]')?.textContent ?? "aside", `${locale}`).toMatch(/^(Reviewer…|aside)$/);
          expect(host.querySelector('[data-team-work-item="step:t"] [data-team-part="who"]'), locale).toBeNull();
          expect(host.querySelector('[data-team-work-item="step:t"] [data-team-part="action"]')?.textContent, locale).toMatch(/…$/);
        }
        if (width === 600) expect(host.querySelector('[data-team-work-item="step:q"] [data-team-part="who"]')?.textContent, locale).toBe(LONG);
      }
    } finally {
      box.mockRestore();
    }
  });

  it("the keyboard path: every control is a native button, in reading order, and opens the step", async () => {
    await draw(async () => oneName());
    act(() => toggle().click());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    expect(buttons.every((button) => button.type === "button" && button.tabIndex >= 0)).toBe(true);
    const order = buttons.map((button) => button.closest("[data-team-work-item]") ? "work" : button.closest("[data-team-step-open]") ? "step" : "other");
    expect(order.indexOf("work")).toBeLessThan(order.indexOf("step"));
    const step = host.querySelector<HTMLButtonElement>('[data-team-step-open="t2"] [data-coding-open]')!;
    step.focus();
    expect(document.activeElement).toBe(step);
    expect(step.getAttribute("aria-label")).toBe("Open the coding chat of Checker for Review it");
    act(() => step.click());
    expect(onOpenStep).toHaveBeenCalledWith(expect.objectContaining({ botId: "rev", threadId: "t2", name: "Review it", work: "Login fix", index: 2, total: 2 }));
  });
});
