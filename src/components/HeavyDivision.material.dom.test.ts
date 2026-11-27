// @vitest-environment happy-dom
// A bot in a material (Fluffy, Glass) wears it in its cells: the bot's still
// over its body while nothing divides, each expert's in its cell once it has
// its colour, and the flat volume is off where a still is worn. The engine's
// painting itself needs WebGL2 (real Chrome: scripts/capture/heavy-division.mjs
// --material); here the material and its stills are stand-ins.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Message } from "@/state/store";
import type { HeavyTeamLine } from "../../shared/heavy-team";
import type { MaterialStillRequest } from "./shape-material-still";
import { loadAllBakedStills } from "./shape-stills";

const asked: MaterialStillRequest[] = [];
vi.mock("./shape-material", () => ({ useShapeMaterial: (name: string) => (name === "flat" ? null : { id: name, render: () => null }) }));
vi.mock("./shape-material-still", () => ({
  materialStill: (request: MaterialStillRequest) => {
    asked.push(request);
    return Promise.resolve({ href: `data:image/png;base64,${request.color.slice(1)}`, x: -4, y: -4, size: 108 });
  },
}));

const { HeavyLeaderContext, HeavyTeamRow } = await import("./HeavyTeamRow");
const { expertPaint } = await import("./HeavyDivision");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = 1_000_000;
const team = (count: number, over: Partial<HeavyTeamLine> = {}): HeavyTeamLine => ({
  phase: count ? "agents" : "planning",
  startedAt: T0,
  updatedAt: T0 + 6_000,
  maxRounds: 5,
  rounds: count ? [{ n: 1, kind: "propose", startedAt: T0 + 1_000 }] : [],
  agents: Array.from({ length: count }, (_, index) => ({ n: index + 1, engineLabel: "ada@example.com", modelLabel: "Nimbus 1", status: "working" as const, messages: [] })),
  leader: { engineLabel: "ada@example.com", modelLabel: "Nimbus 1", steps: [] },
  ...over,
});
const message = (line: HeavyTeamLine, id: string): Message => ({ id, at: T0, role: "bot", kind: "activity", tool: { name: "Team of Experts", ok: true, team: line } } as Message);
const bot = { name: "Nimbus", color: "amber", mascotLook: { character: "shape", shape: "cat", material: "glass" } };

let host: HTMLDivElement;
let root: Root;
let frames: FrameRequestCallback[] = [];
let clock = 0;
const row = async (line: HeavyTeamLine, busy: boolean, id: string) => {
  await act(async () => {
    root.render(createElement(HeavyLeaderContext, { value: bot as never }, createElement(HeavyTeamRow, { message: message(line, id), busy })));
  });
  // the stills come back on the next turn
  await act(async () => { await Promise.resolve(); });
};
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
const cells = () => [...host.querySelectorAll("[data-heavy-cell]")];
function pump(seconds: number): void {
  for (let frame = 0; frame < seconds * 60 && frames.length; frame += 1) {
    clock += 1000 / 60;
    const due = frames;
    frames = [];
    for (const callback of due) callback(clock);
  }
}

beforeAll(async () => {
  await loadAllBakedStills();
});
beforeEach(() => {
  setLocale("en");
  asked.length = 0;
  frames = [];
  clock = 10_000;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => { frames = []; });
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a bot in a material divides into cells that wear it", () => {
  it("shows the bot in its material while the leader picks the team, its flat body under it hidden", async () => {
    await row(team(0), true, "glass-planning");
    expect($("[data-heavy-division]")!.dataset.heavyMaterial).toBe("glass");
    const own = $("[data-heavy-own]")!;
    expect(own.getAttribute("href")).toBe("data:image/png;base64,f2a51a");
    expect(own.getAttribute("opacity")).toBe("1");
    expect($("[data-heavy-membrane]")!.getAttribute("opacity")).toBe("0");
    // the still has its own eyes: the drawn ones are off
    expect(cells()[0]!.querySelector("[data-heavy-eyes]")!.getAttribute("opacity")).toBe("0");
    expect(asked[0]).toMatchObject({ color: "#f2a51a", state: "idle" });
  });

  it("each expert wears its own still, in its colour, once the pile has closed up; the flat volume is off", async () => {
    await row(team(0), true, "glass-run");
    await row(team(4), true, "glass-run");
    pump(30);
    expect(cells()).toHaveLength(4);
    cells().forEach((cell, index) => {
      const image = cell.querySelector("image")!;
      expect(image.getAttribute("href")).toBe(`data:image/png;base64,${expertPaint(index).color.slice(1)}`);
      expect(image.getAttribute("width")).toBe("108");
      expect(cell.querySelector("use:not([stroke])")!.getAttribute("display")).toBe("none");
      expect(cell.querySelector("[data-heavy-shade]")!.getAttribute("opacity")).toBe("0");
    });
    expect(new Set(asked.map((request) => request.color)).size).toBe(5);
  });
});
