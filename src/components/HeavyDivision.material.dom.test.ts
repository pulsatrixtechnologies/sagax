// @vitest-environment happy-dom
// A bot in a material (Fluffy, Glass) wears it in its cells: the bot's still
// over its body while nothing divides, the same still of the bot in every
// expert's cell (no colour of its own, M-20261127-178), and the flat volume
// is off where a still is worn. The engine's
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
// the rest of the module as it is: the row's leader and pile are the bot's real avatar (M-20261127-178)
vi.mock("./shape-material", async (importOriginal) => ({ ...(await importOriginal<object>()), useShapeMaterial: (name: string) => (name === "flat" ? null : { id: name, render: () => null }) }));
vi.mock("./shape-material-still", () => ({
  materialStill: (request: MaterialStillRequest) => {
    asked.push(request);
    return Promise.resolve({ href: `data:image/png;base64,${request.color.slice(1)}`, x: -4, y: -4, size: 108 });
  },
}));

const { HeavyLeaderContext, HeavyTeamRow } = await import("./HeavyTeamRow");

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
let frameIds: number[] = [];
let lastFrameId = 0;
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
    frameIds = [];
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
  // each frame cancelled by its own id, as a browser does: the bot's own avatar beside the division asks for frames too
  frameIds = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    frameIds.push(++lastFrameId);
    return lastFrameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    const at = frameIds.indexOf(id);
    if (at < 0) return;
    frames.splice(at, 1);
    frameIds.splice(at, 1);
  });
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
  it("shows the bot in its material as the division starts, its flat body under it hidden", async () => {
    await row(team(0), true, "glass-planning");
    await row(team(2), true, "glass-planning");
    expect($("[data-heavy-division]")!.dataset.heavyMaterial).toBe("glass");
    const own = $("[data-heavy-own]")!;
    expect(own.getAttribute("href")).toBe("data:image/png;base64,f2a51a");
    expect(own.getAttribute("opacity")).toBe("1");
    expect($("[data-heavy-membrane]")!.getAttribute("opacity")).toBe("0");
    // the still has its own eyes: the drawn ones are off
    expect(cells()[0]!.querySelector("[data-heavy-eyes]")!.getAttribute("opacity")).toBe("0");
    expect(asked[0]).toMatchObject({ color: "#f2a51a", state: "idle" });
  });

  it("every expert wears the bot's own still once the pile has closed up, never one of its own colour; the flat volume is off", async () => {
    await row(team(0), true, "glass-run");
    await row(team(4), true, "glass-run");
    pump(30);
    expect(cells()).toHaveLength(4);
    for (const cell of cells()) {
      const image = cell.querySelector("image")!;
      expect(image.getAttribute("href")).toBe("data:image/png;base64,f2a51a");
      expect(image.getAttribute("width")).toBe("108");
      expect(cell.querySelector("use:not([stroke])")!.getAttribute("display")).toBe("none");
      expect(cell.querySelector("[data-heavy-shade]")!.getAttribute("opacity")).toBe("0");
    }
    // one still, the bot's: no colour per expert is ever painted
    expect(new Set(asked.map((request) => request.color))).toEqual(new Set(["#f2a51a"]));
  });
});
