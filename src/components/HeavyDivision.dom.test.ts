// @vitest-environment happy-dom
// The cell division of a Heavy run in the chat's row (M-20261126-122): the
// row draws as many cells as the run has experts (2 to 8), each one the
// bot's own shape; a run that is over is drawn finished and never replayed;
// reduced motion (the device's, the app's, the mascot's own setting) lands
// the steps at once; a bot whose mascot is a character keeps the owls.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Message } from "@/state/store";
import type { HeavyTeamLine } from "../../shared/heavy-team";
import { divisionShape, expertPaint } from "./HeavyDivision";
import { HeavyLeaderContext, HeavyTeamRow } from "./HeavyTeamRow";
import { bakedStill, loadAllBakedStills } from "./shape-stills";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = 1_000_000;
const team = (count: number, over: Partial<HeavyTeamLine> = {}): HeavyTeamLine => ({
  phase: count ? "agents" : "planning",
  startedAt: T0,
  updatedAt: T0 + 6_000,
  maxRounds: 5,
  rounds: count ? [{ n: 1, kind: "propose", startedAt: T0 + 1_000 }] : [],
  agents: Array.from({ length: count }, (_, index) => ({ n: index + 1, persona: `Persona ${index + 1}`, engineLabel: "ada@example.com", modelLabel: "Nimbus 1", status: "working" as const, messages: [] })),
  leader: { engineLabel: "ada@example.com", modelLabel: "Nimbus 1", steps: [] },
  ...over,
});
const done = (count: number): HeavyTeamLine => team(count, { phase: "done", outcome: "agreed", thoughtEndedAt: T0 + 8_000, rounds: [{ n: 1, kind: "propose", startedAt: T0, endedAt: T0 + 8_000, agreed: true }] });
const message = (line: HeavyTeamLine, id = "m1"): Message => ({ id, at: T0, role: "bot", kind: "activity", tool: { name: "Team of Experts", ok: true, team: line } } as Message);
type Bot = NonNullable<Parameters<typeof divisionShape>[0]>;
const shapeBot = (shape: string, over: object = {}): Bot => ({ name: "Nimbus", color: "amber", mascotLook: { character: "shape", shape, ...over } } as Bot);

let host: HTMLDivElement;
let root: Root;
/** The frames the page was asked for and has not drawn yet. */
let frames: FrameRequestCallback[] = [];
let clock = 0;
const row = (bot: Bot | null, line: HeavyTeamLine, busy: boolean, id = "m1") =>
  act(() => root.render(createElement(HeavyLeaderContext, { value: bot }, createElement(HeavyTeamRow, { message: message(line, id), busy }))));
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
const cells = () => [...host.querySelectorAll("[data-heavy-cell]")];
/** Draw the frames the row asks for, 16 ms apart, until it asks for none or `seconds` have passed. */
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
  delete document.documentElement.dataset.reducedMotion;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the division in the chat's row", () => {
  it("while the leader picks its team the row shows the bot's own mascot, alone, against the header", async () => {
    await row(shapeBot("cat"), team(0), true);
    expect(cells()).toHaveLength(1);
    expect($("[data-heavy-division]")!.dataset.shape).toBe("cat");
    expect($("[data-heavy-division]")!.nextElementSibling).toBe($("[data-heavy-header]"));
    expect($("[data-heavy-header]")!.textContent).toMatch(/^Leader picking the team/);
  });

  it.each([2, 3, 4, 5, 6, 7, 8])("divides into the %i experts the run announces, each in its colour", async (count) => {
    await row(shapeBot("cat"), team(0), true, `run-${count}`);
    await row(shapeBot("cat"), team(count), true, `run-${count}`);
    expect(cells()).toHaveLength(1);
    pump(1);
    expect($("[data-heavy-division]")!.dataset.heavyDivision).toBe("dividing");
    pump(30);
    expect(cells()).toHaveLength(count);
    expect(cells().map((cell) => cell.getAttribute("data-heavy-expert"))).toEqual(Array.from({ length: count }, (_, index) => String(index + 1)));
    expect(cells().map((cell) => cell.querySelector("use:not([stroke])")!.getAttribute("fill"))).toEqual(Array.from({ length: count }, (_, index) => expertPaint(index).color));
    expect(new Set(cells().map((cell) => cell.querySelector("use:not([stroke])")!.getAttribute("fill"))).size).toBe(count);
    // the drawing is exactly as wide as its pile, so the text stays against it
    expect($("[data-heavy-division]")!.getAttribute("width")).toBe(String(22 + 16 * (count - 1)));
    expect($("[data-heavy-division]")!.getAttribute("aria-label")).toBe(`${count} experts`);
  });

  it.each(["cat", "star", "circle", "ghost"])("starts from the bot's own shape (%s) and every expert keeps it: only the colour changes", async (shape) => {
    await row(shapeBot(shape), done(5), false);
    const svg = $("[data-heavy-division]")!;
    expect(svg.dataset.shape).toBe(shape);
    // the body in the defs is this shape's own still, the one every other avatar of the bot draws
    const body = svg.querySelector("defs [id$='-body']")!;
    const drawn = [...body.querySelectorAll("path")].map((path) => path.getAttribute("d"));
    const own = bakedStill(shape as Parameters<typeof bakedStill>[0])!.paths.map(([, d]) => d);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((d) => own.includes(d!))).toBe(true);
    // and each of the five cells is that one body, drawn again
    for (const cell of cells()) {
      const uses = [...cell.querySelectorAll("use")].map((use) => use.getAttribute("href"));
      expect(uses).toEqual([`#${body.id.replace(/-body$/, "-edge")}`, `#${body.id}`, `#${body.id.replace(/-body$/, "-eyes")}`]);
    }
    expect(cells()).toHaveLength(5);
  });

  it("the bot's own colour is the cell that divides", async () => {
    await row(shapeBot("cat", { bodyColor: "#123abc" }), team(0), true);
    expect($("[data-heavy-division] > g")!.getAttribute("fill")).toBe("#123abc");
  });

  it("a run that is over, read back from history, is drawn finished and never replays its division", async () => {
    await row(shapeBot("cat"), done(4), false);
    expect(cells()).toHaveLength(4);
    expect($("[data-heavy-division]")!.dataset.heavyDivision).toBe("rest");
    expect(cells().map((cell) => cell.getAttribute("data-heavy-expert"))).toEqual(["1", "2", "3", "4"]);
    // nothing moves: no frame was asked for, and the membrane's layer is off
    expect(frames).toHaveLength(0);
    expect($("[data-heavy-division] > g")!.getAttribute("display")).toBe("none");
    expect($("[data-heavy-division] > g")!.hasAttribute("filter")).toBe(false);
    expect($("[data-heavy-header]")!.textContent).toBe("Thought for 8s");
  });

  it("a division already shown is not played again when its row comes back", async () => {
    await row(shapeBot("cat"), team(3), true, "seen");
    pump(30);
    expect(cells()).toHaveLength(3);
    act(() => root.unmount());
    root = createRoot(host);
    await row(shapeBot("cat"), team(3), true, "seen");
    expect(cells()).toHaveLength(3);
    expect($("[data-heavy-division]")!.dataset.heavyDivision).toBe("live");
  });

  it("when the run ends the cells stop breathing and no more frame is asked for", async () => {
    await row(shapeBot("cat"), team(2), true, "ends");
    pump(30);
    expect(frames.length).toBe(1);
    await row(shapeBot("cat"), done(2), false, "ends");
    pump(1);
    expect(frames).toHaveLength(0);
    expect($("[data-heavy-division]")!.dataset.heavyDivision).toBe("rest");
    expect(cells()).toHaveLength(2);
  });

  it("under the app's reduced motion the steps show without animation", async () => {
    document.documentElement.dataset.reducedMotion = "true";
    await row(shapeBot("cat"), team(0), true, "calm");
    expect(cells()).toHaveLength(1);
    await row(shapeBot("cat"), team(6), true, "calm");
    expect(cells()).toHaveLength(6);
    expect($("[data-heavy-division]")!.dataset.heavyDivision).toBe("rest");
    expect(frames).toHaveLength(0);
  });

  it("under the device's reduced motion too, and under the mascot's own Motion setting", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
    await row(shapeBot("cat"), team(4), true, "device");
    expect(cells()).toHaveLength(4);
    expect(frames).toHaveLength(0);
    vi.unstubAllGlobals();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    await row(shapeBot("cat", { motion: "reduced" }), team(4), true, "mascot");
    expect(cells()).toHaveLength(4);
    expect(frames).toHaveLength(0);
  });

  it("a bot whose mascot is a character, or its own picture, keeps the pile of owls and divides into nothing", async () => {
    expect(divisionShape({ color: "blue" } as Bot)).toBeNull();
    expect(divisionShape({ color: "blue", mascotLook: { character: "shiba" } } as Bot)).toBeNull();
    expect(divisionShape({ color: "blue", avatarUrl: "/api/attachments/a.png", avatarCrop: "circle", mascotLook: { character: "shape", shape: "cat" } } as Bot)).toBeNull();
    expect(divisionShape(shapeBot("cat"))).toBe("cat");
    await row({ color: "blue" } as Bot, team(3), true);
    expect($("[data-heavy-division]")).toBeNull();
    expect(host.querySelectorAll("[data-heavy-avatars] > span")).toHaveLength(3);
  });
});
