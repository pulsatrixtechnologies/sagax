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
import { OBJECT_SHAPE_BY_ID } from "../../shared/shape-avatar-presets";
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
    // and each of the five cells is that one body, drawn again: its ring, its body, its volume (off for a flat body) and its eyes
    for (const cell of cells()) {
      const uses = [...cell.querySelectorAll("use")].map((use) => use.getAttribute("href"));
      expect(uses).toEqual([`#${body.id.replace(/-body$/, "-edge")}`, `#${body.id}`, `#${body.id.replace(/-body$/, "-edge")}`, `#${body.id.replace(/-body$/, "-eyes")}`]);
      expect(cell.querySelector("[data-heavy-shade]")!.getAttribute("opacity")).toBe("0");
    }
    expect(cells()).toHaveLength(5);
  });

  it.each(["cat", "star", "ghost"])("divides as the bot's own silhouette (%s): the membrane is its body, never a disc", async (shape) => {
    await row(shapeBot(shape), team(0), true, `goo-${shape}`);
    await row(shapeBot(shape), team(2), true, `goo-${shape}`);
    const svg = $("[data-heavy-division]")!;
    const body = svg.querySelector("defs [id$='-body']")!;
    // half way through the division: the two cells are one membrane, blurred then cut at a threshold
    pump(1.2);
    expect(svg.dataset.heavyDivision).toBe("dividing");
    expect($("[data-heavy-division] > g")!.getAttribute("filter")).toMatch(/goo/);
    const membranes = [...svg.querySelectorAll("[data-heavy-membrane]")];
    expect(membranes).toHaveLength(2);
    for (const membrane of membranes) expect(membrane.getAttribute("href")).toBe(`#${body.id}`);
    expect(svg.querySelectorAll("circle, ellipse")).toHaveLength(0);
    pump(30);
    expect(cells()).toHaveLength(2);
  });

  it("a bot in a material the page cannot paint divides into flat cells with the mock-up's simple volume", async () => {
    await row(shapeBot("cat", { material: "fluffy" }), done(3), false, "fluffy");
    expect(cells()).toHaveLength(3);
    for (const cell of cells()) expect(Number(cell.querySelector("[data-heavy-shade]")!.getAttribute("opacity"))).toBe(1);
    expect($("[data-heavy-division] defs radialGradient")).not.toBeNull();
  });

  it("an expert that fails mid-run stays marked: its cell is dimmed, and its line in the preview says so", async () => {
    const working = team(3);
    await row(shapeBot("cat"), team(0), true, "fails");
    await row(shapeBot("cat"), working, true, "fails");
    pump(30);
    const failedLine = team(3, { agents: working.agents.map((agent) => (agent.n === 2 ? { ...agent, status: "failed" as const, messages: ["My plan."] } : agent)) });
    await row(shapeBot("cat"), failedLine, true, "fails");
    expect(cells().map((cell) => cell.hasAttribute("data-heavy-failed"))).toEqual([false, true, false]);
    expect(cells()[1]!.querySelector("use:not([stroke])")!.getAttribute("opacity")).toBe("0.45");
    expect(cells()[0]!.querySelector("use:not([stroke])")!.getAttribute("opacity")).toBe("1");
    expect($("[data-heavy-agent='2']")!.textContent).toBe("Expert 2 · Persona 2Did not finish · My plan.");
    // the division goes on: nothing started over
    expect(cells()).toHaveLength(3);
  });

  it("a row that first shows once the experts are past their first round starts as the pile, never replays its division", async () => {
    const leader = team(4, { phase: "leader", rounds: [{ n: 1, kind: "propose", startedAt: T0, endedAt: T0 + 5_000 }] });
    await row(shapeBot("cat"), leader, true, "late-leader");
    expect(cells()).toHaveLength(4);
    expect($("[data-heavy-division]")!.dataset.heavyDivision).toBe("live");
    const second = team(4, { rounds: [{ n: 1, kind: "propose", startedAt: T0, endedAt: T0 + 5_000 }, { n: 2, kind: "critique", startedAt: T0 + 5_000 }] });
    await row(shapeBot("cat"), second, true, "late-round");
    expect(cells()).toHaveLength(4);
    expect($("[data-heavy-division]")!.dataset.heavyDivision).toBe("live");
  });

  it("reduced motion turned on mid-run is followed: the division lands at once", async () => {
    await row(shapeBot("cat"), team(0), true, "switch");
    await row(shapeBot("cat"), team(8), true, "switch");
    pump(1);
    expect($("[data-heavy-division]")!.dataset.heavyDivision).toBe("dividing");
    await act(async () => {
      document.documentElement.dataset.reducedMotion = "true";
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(cells()).toHaveLength(8);
    expect($("[data-heavy-division]")!.dataset.heavyDivision).toBe("rest");
    pump(1);
    expect(frames).toHaveLength(0);
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

  it("a bot whose shape is its own drawing keeps its cells when the row draws again mid-division", async () => {
    // a fresh copy of the look on every draw, as the chat's bot is parsed again on every patch of the run
    const own = () => shapeBot("cup", { avatarDef: structuredClone({ ...OBJECT_SHAPE_BY_ID.cup, id: "my-own-mascot" }) });
    await row(own(), team(0), true, "own");
    await row(own(), team(8), true, "own");
    pump(3);
    const before = cells().length;
    expect(before).toBeGreaterThan(1);
    // the row's clock ticks every second and the server patches the run: the same line, drawn again
    await row(own(), team(8), true, "own");
    expect(cells()).toHaveLength(before);
    pump(30);
    expect(cells()).toHaveLength(8);
    expect($("[data-heavy-division]")!.dataset.heavyDivision).toBe("live");
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

  it("a bot whose mascot is a character shows itself while its leader picks the team, as the orbit's centre did", async () => {
    await row({ name: "Nimbus", color: "blue" } as Bot, team(0), true, "owl-planning");
    expect($("[data-heavy-leader-avatar] [data-owl]")).not.toBeNull();
    expect($("[data-heavy-leader-avatar]")!.nextElementSibling).toBe($("[data-heavy-header]"));
    await row({ name: "Nimbus", color: "blue" } as Bot, team(3), true, "owl-planning");
    expect($("[data-heavy-leader-avatar]")).toBeNull();
    expect(host.querySelectorAll("[data-heavy-owl]")).toHaveLength(3);
  });
});
