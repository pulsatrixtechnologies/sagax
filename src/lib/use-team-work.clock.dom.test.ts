// @vitest-environment happy-dom
// #3624: the Coding section's clock redraws only when what it shows changes:
// an age in minutes redraws once a minute, not every second. Counted in
// renders, never in milliseconds.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildTeamWork, type TeamStepFacts } from "../../shared/team-work";
import { useTeamWork } from "./use-team-work";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const START = Date.UTC(2026, 10, 11, 15, 0, 0);

function workWithLastAction(agoMs: number) {
  const now = Date.now();
  const step: TeamStepFacts = {
    id: "h1", botId: "tester", requesterBotId: "lead", threadId: "t1", title: "Tests", work: "Compact cards", mode: "work",
    status: "running", createdAt: now - 20 * 60_000, startedAt: now - 20 * 60_000, coding: true,
    turn: { startedAt: now - 20 * 60_000, lastActionAt: now - agoMs },
  };
  return buildTeamWork({ orchestratorId: "lead", now, since: now - 12 * 3_600_000, steps: [step], names: new Map([["tester", { name: "Tester" }]]) });
}

let host: HTMLDivElement;
let root: Root;
let renders = 0;

function mount(agoMs: number) {
  const work = workWithLastAction(agoMs);
  function Section() {
    renders += 1;
    useTeamWork("lead", { load: async () => work, clock: Date.now });
    return null;
  }
  act(() => root.render(createElement(Section)));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  renders = 0;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
/** One second at a time, each in its own act, so every redraw is counted. */
const wait = async (ms: number) => {
  for (let at = 0; at < ms; at += 1_000) await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
};

describe("the Coding section's clock (#3624)", () => {
  it("does not redraw while its ages stay in the same minute", async () => {
    mount(90_000); // "1 min ago" until two minutes have passed
    await settle();
    const drawn = renders;
    await wait(25_000);
    expect(renders - drawn).toBe(0);
    // the minute turns: one redraw
    await wait(10_000);
    expect(renders - drawn).toBe(1);
  });

  it("redraws every second while an age counts seconds", async () => {
    mount(5_000); // "5 s ago"
    await settle();
    const drawn = renders;
    await wait(10_000);
    expect(renders - drawn).toBe(10);
  });
});
