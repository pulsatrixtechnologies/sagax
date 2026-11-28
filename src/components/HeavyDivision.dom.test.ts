// @vitest-environment happy-dom
// The cell division of a Heavy run in the chat's row (M-20261126-122): the
// row draws as many cells as the run has experts (2 to 8), each one the
// bot's own shape in the bot's own colour, then the pile of the bot's own
// avatars (M-20261127-178); a run that is over is that pile at once and never
// replays; reduced motion (the device's, the app's, the mascot's own
// setting) lands the steps at once; a character or a photo divides as a
// round in its colour.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Message } from "@/state/store";
import type { HeavyTeamLine } from "../../shared/heavy-team";
import { OBJECT_SHAPE_BY_ID } from "../../shared/shape-avatar-presets";
import { divisionShape } from "./HeavyDivision";
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
/** The frames the page was asked for and has not drawn yet, each cancelled by its own id as a browser does. */
let frames: FrameRequestCallback[] = [];
let frameIds: number[] = [];
let lastFrameId = 0;
let clock = 0;
function stubFrames() {
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
}
const row = (bot: Bot | null, line: HeavyTeamLine, busy: boolean, id = "m1") =>
  act(() => root.render(createElement(HeavyLeaderContext, { value: bot }, createElement(HeavyTeamRow, { message: message(line, id), busy }))));
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
const cells = () => [...host.querySelectorAll("[data-heavy-cell]")];
/** The pile of the bot's own avatars, once the division has closed up (or at once for a run already over). */
const pile = () => [...host.querySelectorAll<HTMLElement>("[data-heavy-pile] [data-heavy-expert-avatar]")];
/** The division tells the row it reached its pile from its clock, outside React: the row draws again. */
const settle = () => act(async () => { await Promise.resolve(); });
const fill = (cell: Element) => cell.querySelector("use:not([stroke])")!.getAttribute("fill");
/** Draw the frames the row asks for, 16 ms apart, until it asks for none or `seconds` have passed. */
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
  frames = [];
  frameIds = [];
  clock = 10_000;
  stubFrames();
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
  it("while the leader picks its team the row shows the bot's own avatar, alone, against the header", async () => {
    await row(shapeBot("cat"), team(0), true);
    expect(cells()).toHaveLength(0);
    expect($("[data-heavy-leader-avatar] [data-shape]")!.dataset.shape).toBe("cat");
    expect($("[data-heavy-leader-avatar]")!.nextElementSibling).toBe($("[data-heavy-header]"));
    expect($("[data-heavy-header]")!.textContent).toMatch(/^Leader picking the team/);
  });

  it.each([2, 3, 4, 5, 6, 7, 8])("divides into the %i experts the run announces, each the bot in its own colour, then the pile of its avatars", async (count) => {
    await row(shapeBot("cat"), team(0), true, `run-${count}`);
    await row(shapeBot("cat"), team(count), true, `run-${count}`);
    expect(cells()).toHaveLength(1);
    pump(1);
    expect($("[data-heavy-division]")!.dataset.heavyDivision).toBe("dividing");
    pump(30);
    expect(cells()).toHaveLength(count);
    expect(cells().map((cell) => cell.getAttribute("data-heavy-expert"))).toEqual(Array.from({ length: count }, (_, index) => String(index + 1)));
    // no colour of its own (M-20261127-178): every cell is the bot's colour, the membrane's
    const own = $("[data-heavy-division] > g")!.getAttribute("fill");
    expect(cells().map(fill)).toEqual(Array.from({ length: count }, () => own));
    // the drawing is exactly as wide as its pile, so the text stays against it
    expect($("[data-heavy-division]")!.getAttribute("width")).toBe(String(22 + 16 * (count - 1)));
    expect($("[data-heavy-division]")!.getAttribute("aria-label")).toBe(`${count} experts`);
    // the pile closed up: the bot's own avatar once per expert
    await settle();
    expect(pile()).toHaveLength(count);
    for (const expert of pile()) expect(expert.querySelector<HTMLElement>("[data-shape]")!.dataset.shape).toBe("cat");
    expect($("[data-heavy-pile] [data-heavy-avatars]")!.getAttribute("aria-label")).toBe(`${count} experts`);
  });

  it.each(["cat", "star", "circle", "ghost"])("divides from the bot's own shape (%s) and every cell keeps it, and its colour", async (shape) => {
    await row(shapeBot(shape), team(0), true, `own-${shape}`);
    await row(shapeBot(shape), team(5), true, `own-${shape}`);
    const svg = $("[data-heavy-division]")!;
    expect(svg.dataset.shape).toBe(shape);
    // the body in the defs is this shape's own still, the one every other avatar of the bot draws
    const body = svg.querySelector("defs [id$='-body']")!;
    const drawn = [...body.querySelectorAll("path")].map((path) => path.getAttribute("d"));
    const own = bakedStill(shape as Parameters<typeof bakedStill>[0])!.paths.map(([, d]) => d);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((d) => own.includes(d!))).toBe(true);
    pump(30);
    // and each of the five cells is that one body, drawn again: its ring, its body, its volume (off for a flat body) and its eyes
    for (const cell of cells()) {
      const uses = [...cell.querySelectorAll("use")].map((use) => use.getAttribute("href"));
      expect(uses).toEqual([`#${body.id.replace(/-body$/, "-edge")}`, `#${body.id}`, `#${body.id.replace(/-body$/, "-edge")}`, `#${body.id.replace(/-body$/, "-eyes")}`]);
      expect(cell.querySelector("[data-heavy-shade]")!.getAttribute("opacity")).toBe("0");
    }
    expect(cells()).toHaveLength(5);
    expect(new Set(cells().map(fill))).toEqual(new Set([svg.querySelector(":scope > g")!.getAttribute("fill")]));
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
    await row(shapeBot("cat", { material: "fluffy" }), team(0), true, "fluffy");
    await row(shapeBot("cat", { material: "fluffy" }), team(3), true, "fluffy");
    pump(30);
    expect(cells()).toHaveLength(3);
    for (const cell of cells()) expect(Number(cell.querySelector("[data-heavy-shade]")!.getAttribute("opacity"))).toBe(1);
    expect($("[data-heavy-division] defs radialGradient")).not.toBeNull();
  });

  it("an expert that fails mid-run stays marked: its cell is dimmed, then its avatar in the pile, and its line in the preview says so", async () => {
    const working = team(3);
    await row(shapeBot("cat"), team(0), true, "fails");
    await row(shapeBot("cat"), working, true, "fails");
    pump(1);
    const failedLine = team(3, { agents: working.agents.map((agent) => (agent.n === 2 ? { ...agent, status: "failed" as const, messages: ["My plan."] } : agent)) });
    await row(shapeBot("cat"), failedLine, true, "fails");
    pump(30);
    expect(cells().map((cell) => cell.hasAttribute("data-heavy-failed"))).toEqual([false, true, false]);
    expect(cells()[1]!.querySelector("use:not([stroke])")!.getAttribute("opacity")).toBe("0.45");
    expect(cells()[0]!.querySelector("use:not([stroke])")!.getAttribute("opacity")).toBe("1");
    expect($("[data-heavy-agent='2']")!.textContent).toBe("Expert 2 · Persona 2Did not finish · My plan.");
    // the division went on: nothing started over
    expect(cells()).toHaveLength(3);
    await settle();
    expect(pile().map((expert) => expert.hasAttribute("data-heavy-failed"))).toEqual([false, true, false]);
    expect((pile()[1]!.firstElementChild as HTMLElement).style.opacity).toBe("0.45");
  });

  it("a row that first shows once the experts are past their first round starts as the pile, never replays its division", async () => {
    const leader = team(4, { phase: "leader", rounds: [{ n: 1, kind: "propose", startedAt: T0, endedAt: T0 + 5_000 }] });
    await row(shapeBot("cat"), leader, true, "late-leader");
    expect(pile()).toHaveLength(4);
    expect($("[data-heavy-division]")).toBeNull();
    const second = team(4, { rounds: [{ n: 1, kind: "propose", startedAt: T0, endedAt: T0 + 5_000 }, { n: 2, kind: "critique", startedAt: T0 + 5_000 }] });
    await row(shapeBot("cat"), second, true, "late-round");
    expect(pile()).toHaveLength(4);
    expect($("[data-heavy-division]")).toBeNull();
  });

  it("reduced motion turned on mid-run is followed: the division lands at once, into the pile", async () => {
    await row(shapeBot("cat"), team(0), true, "switch");
    await row(shapeBot("cat"), team(8), true, "switch");
    pump(1);
    expect($("[data-heavy-division]")!.dataset.heavyDivision).toBe("dividing");
    await act(async () => {
      document.documentElement.dataset.reducedMotion = "true";
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();
    expect(pile()).toHaveLength(8);
    // nothing fades under reduced motion: the division is gone at once, and its clock with it
    expect($("[data-heavy-division]")).toBeNull();
    pump(1);
    expect(frames).toHaveLength(0);
  });

  it("the bot's own colour, a free one too, is the cell that divides and every expert's", async () => {
    await row(shapeBot("cat", { bodyColor: "#123abc" }), team(0), true, "free");
    await row(shapeBot("cat", { bodyColor: "#123abc" }), team(3), true, "free");
    expect($("[data-heavy-division] > g")!.getAttribute("fill")).toBe("#123abc");
    pump(30);
    expect(cells().map(fill)).toEqual(["#123abc", "#123abc", "#123abc"]);
  });

  it("a run that is over, read back from history, is the pile at once and never replays its division", async () => {
    await row(shapeBot("cat"), done(4), false);
    expect(pile()).toHaveLength(4);
    expect(pile().map((expert) => expert.getAttribute("data-heavy-expert-avatar"))).toEqual(["1", "2", "3", "4"]);
    expect($("[data-heavy-division]")).toBeNull();
    // nothing moves: no frame was asked for
    expect(frames).toHaveLength(0);
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
    expect(pile()).toHaveLength(3);
    expect($("[data-heavy-division]")).toBeNull();
  });

  it("when the run ends the cells stop breathing and no more frame is asked for", async () => {
    await row(shapeBot("cat"), team(2), true, "ends");
    pump(30);
    expect(cells()).toHaveLength(2);
    await row(shapeBot("cat"), done(2), false, "ends");
    pump(1);
    expect(frames).toHaveLength(0);
    expect(pile()).toHaveLength(2);
  });

  it("under the app's reduced motion the steps show without animation", async () => {
    document.documentElement.dataset.reducedMotion = "true";
    await row(shapeBot("cat"), team(0), true, "calm");
    expect($("[data-heavy-leader-avatar]")).not.toBeNull();
    await row(shapeBot("cat"), team(6), true, "calm");
    await settle();
    expect(pile()).toHaveLength(6);
    expect($("[data-heavy-division]")).toBeNull();
    expect(frames).toHaveLength(0);
  });

  it("under the device's reduced motion too, and under the mascot's own Motion setting", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
    await row(shapeBot("cat"), team(4), true, "device");
    await settle();
    expect(pile()).toHaveLength(4);
    expect(frames).toHaveLength(0);
    vi.unstubAllGlobals();
    stubFrames();
    await row(shapeBot("cat", { motion: "reduced" }), team(4), true, "mascot");
    await settle();
    expect(pile()).toHaveLength(4);
    expect(frames).toHaveLength(0);
  });

  it("a bot whose mascot is a character, or its own picture, has no shape of its own: it divides as a round (D-20261126-037)", () => {
    expect(divisionShape({ color: "blue" } as Bot)).toBeNull();
    expect(divisionShape({ color: "blue", mascotLook: { character: "shiba" } } as Bot)).toBeNull();
    expect(divisionShape({ color: "blue", avatarUrl: "/api/attachments/a.png", avatarCrop: "circle", mascotLook: { character: "shape", shape: "cat" } } as Bot)).toBeNull();
    expect(divisionShape(shapeBot("cat"))).toBe("cat");
  });

  it("a character bot: the bot while its leader picks, then a round in its colour divides, then each cell is the bot's own character again, in its own colour", async () => {
    const owl = { name: "Nimbus", color: "blue" } as Bot;
    await row(owl, team(0), true, "owl-run");
    expect($("[data-heavy-leader-avatar] [data-owl]")).not.toBeNull();
    expect($("[data-heavy-leader-avatar]")!.nextElementSibling).toBe($("[data-heavy-header]"));
    await row(owl, team(3), true, "owl-run");
    // the round, in the bot's own colour, divides, and every cell stays in it
    const svg = $("[data-heavy-division]")!;
    expect(svg.dataset.shape).toBe("circle");
    expect(svg.hasAttribute("data-heavy-character")).toBe(true);
    expect($("[data-heavy-division] > g")!.getAttribute("fill")).toBe("#377fe6");
    pump(1);
    expect(svg.dataset.heavyDivision).toBe("dividing");
    pump(30);
    expect(cells().map(fill)).toEqual(["#377fe6", "#377fe6", "#377fe6"]);
    await settle();
    // the pile closed up: each cell is the bot's own owl, the same one three times, stacked as the pile is
    expect(pile()).toHaveLength(3);
    expect(host.querySelectorAll("[data-heavy-pile] [data-heavy-expert-avatar] [data-owl]")).toHaveLength(3);
    expect(new Set(pile().map((expert) => expert.innerHTML.replace(/_r_[0-9a-z]+_|«r[0-9a-z]+»/g, "ID"))).size).toBe(1);
    expect($("[data-heavy-pile] [data-heavy-avatars]")!.getAttribute("aria-label")).toBe("3 experts");
  });

  it("a character bot's run read back from history is its pile at once, never divided", async () => {
    await row({ name: "Nimbus", color: "blue", mascotLook: { character: "shiba" } } as Bot, done(4), false, "shiba-done");
    expect($("[data-heavy-division]")).toBeNull();
    expect(pile()).toHaveLength(4);
    expect(host.querySelectorAll("[data-heavy-expert-avatar] [data-shiba-skin]")).toHaveLength(4);
    expect(frames).toHaveLength(0);
  });

  it("a bot whose avatar is its own picture divides as a round too, and its experts are its picture", async () => {
    const photo = { name: "Nimbus", color: "teal", avatarUrl: "/api/attachments/a.png", avatarCrop: "circle" } as Bot;
    await row(photo, team(0), true, "photo-run");
    await row(photo, team(2), true, "photo-run");
    expect($("[data-heavy-division]")!.dataset.shape).toBe("circle");
    pump(30);
    await settle();
    const pictures = [...host.querySelectorAll("[data-heavy-pile] [data-heavy-expert-avatar] img")];
    expect(pictures).toHaveLength(2);
    for (const picture of pictures) expect(picture.getAttribute("src")).toBe("/api/attachments/a.png");
  });
});
