// #5349 (#5276, #5277, #5278): a shape takes the engine's six agent states
// from what the bot really does, and the look settings a person chose (mood,
// eye colour, depth, material). A bot nobody touched, at rest, draws exactly
// what it drew before.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { avatarFrame } from "open-bot-avatar";
import { beforeAll, describe, expect, it } from "vitest";
import { MASCOT_SHAPES } from "../../shared/mascot-look";
import { AGENT_STATES, MAUS_COLORS } from "@/lib/mascot";
import { BotAvatar, type BotAvatarProps } from "./Avatar";
import { enginePose, moodFrame, mountPose, runtimeStill, shapeDefinition, shapesMarkup, stateStill, stillUrl } from "./shape-avatar";
import { shapeSkinPaint } from "./shape-look";
import { bakedStill, loadAllBakedStills } from "./shape-stills";
import { ShapeMascot, skinFace } from "./ShapeMascot";

const svgOf = (url: string) => decodeURIComponent(url.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));
const stillOf = (html: string) => /<img src="(data:image\/svg\+xml[^"]+)"/.exec(html)?.[1] ?? null;
type Bot = BotAvatarProps["bot"];
const bot = (extra: Record<string, unknown> = {}, look: Record<string, unknown> = {}) =>
  ({ id: "b", name: "Scout", color: "blue", mascotLook: { character: "shape", shape: "cup", ...look }, ...extra }) as unknown as Bot;
const draw = (props: Partial<BotAvatarProps> & { bot: Bot }) => renderToStaticMarkup(createElement(BotAvatar, { size: 28, animated: false, ...props }));

const BLUE = MAUS_COLORS.blue.toLowerCase();
const INK = shapeSkinPaint("plain", MAUS_COLORS.blue).eyes.toLowerCase();

beforeAll(async () => {
  await loadAllBakedStills();
});

describe("a bot nobody touched draws as before (#5349, D-20261119-031)", () => {
  it("at rest, the still is the shape's baked frame under the key it always had", () => {
    for (const shape of ["cup", "star", "circle", "witch-hat"] as const) {
      const html = draw({ bot: bot({}, { shape }) });
      const before = stillUrl(`${shape}||idle|${BLUE}|${INK}`, moodFrame(bakedStill(shape)!, "idle"), BLUE, INK);
      expect(stillOf(html), shape).toBe(before);
      expect(html, shape).toContain('data-agent-state="idle"');
      expect(html, shape).toContain('data-shape-material="flat"');
    }
  });

  it("a look with every setting at its default draws the same markup as a look without any", () => {
    const plain = draw({ bot: bot() });
    expect(draw({ bot: bot({}, { material: "flat", mood: "neutral", followPointer: true }) })).toBe(plain);
    const large = draw({ bot: bot(), size: 144, animated: true });
    expect(draw({ bot: bot({}, { material: "flat", mood: "neutral", followPointer: true }), size: 144, animated: true }).replace(/shape-[A-Za-z0-9_-]+/g, "uid")).toBe(large.replace(/shape-[A-Za-z0-9_-]+/g, "uid"));
  });

  it("keeps the pose of the bot's own face at rest (a bot about code, a pinned face): the engine's states come from activity only", () => {
    const pinned = draw({ bot: bot({ mascotExpression: "working" }), state: "working" });
    expect(pinned).toContain('data-agent-state="idle"');
    expect(pinned).toContain('data-mood="thinking"');
    expect(stillOf(pinned)).toBe(stillUrl(`cup||thinking|${BLUE}|${INK}`, moodFrame(bakedStill("cup")!, "thinking"), BLUE, INK));
  });
});

describe("the mascot takes the engine's state from the bot's activity", () => {
  it("draws each of the six states, from the live signals on the bot", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{}, "idle"],
      [{ busy: true }, "thinking"],
      [{ activity: "waiting-on-you", busy: true }, "waiting"],
      [{ unread: true }, "done"],
    ];
    for (const [extra, state] of cases) expect(draw({ bot: bot(extra) }), state).toContain(`data-agent-state="${state}"`);
    // a caller that reads the conversation gives the finer state
    expect(draw({ bot: bot({ busy: true }), agentState: "working" })).toContain('data-agent-state="working"');
    expect(draw({ bot: bot(), agentState: "blocked" })).toContain('data-agent-state="blocked"');
  });

  it("gives every state a still of its own, with no ribbon and no animation", () => {
    const def = shapeDefinition("cup");
    const urls = new Set<string>();
    for (const state of AGENT_STATES) {
      const html = draw({ bot: bot(), agentState: state });
      const url = stillOf(html);
      expect(url, state).toBeTruthy();
      expect(html, state).not.toContain("data-shape-live");
      expect(svgOf(url!), state).not.toContain("linearGradient");
      urls.add(url!);
      if (state !== "idle") expect(stateStill(def, state, "neutral").shapes.some((shape) => shape.kind === "ribbon"), state).toBe(false);
    }
    expect(urls.size).toBe(AGENT_STATES.length);
  });

  it("blocked is the engine's exclamation mark; thinking and the others keep the body and both eyes (#5415)", () => {
    for (const shape of MASCOT_SHAPES.slice(0, 6)) {
      const def = shapeDefinition(shape);
      const kinds = (state: (typeof AGENT_STATES)[number]) => {
        const frame = stateStill(def, state, "neutral");
        return { marks: frame.shapes.filter((part) => part.kind === "slice" && part.key.startsWith("mark-")).length, eyes: frame.shapes.filter((part) => part.kind === "eye").length };
      };
      // the engine's thinking still is three dots; the app never draws it for a bot (#5415)
      expect(kinds("thinking"), shape).toEqual({ marks: 3, eyes: 0 });
      expect(enginePose("idle", "thinking", "neutral"), shape).toEqual({ state: "thinking", mood: "neutral", motion: "thinking" });
      expect(kinds("blocked"), shape).toEqual({ marks: 2, eyes: 0 });
      for (const state of ["working", "waiting", "done"] as const) expect(kinds(state), `${shape} ${state}`).toEqual({ marks: 0, eyes: 2 });
    }
  });

  it("a state's still is the engine's own frame for it", () => {
    const def = shapeDefinition("star");
    const still = stateStill(def, "waiting", "neutral");
    const engine = avatarFrame(def, { state: "waiting", mood: "neutral", reducedMotion: true });
    expect(still.shapes.length).toBe(engine.shapes.length);
    expect(still.root).toEqual(engine.root);
  });

  it("maps the app's mood, the bot's state and the person's mood onto one engine pose", () => {
    expect(enginePose("idle", "idle", "neutral")).toEqual({ state: "idle", mood: "neutral", motion: "idle" });
    expect(enginePose("happy", "idle", "neutral")).toEqual({ state: "idle", mood: "happy", motion: "happy" });
    // the at-work pose of the bot's own face stays, at rest
    expect(enginePose("working", "idle", "neutral")).toEqual({ state: "idle", mood: "neutral", motion: "thinking" });
    // what the bot does wins over its face
    expect(enginePose("working", "working", "neutral")).toEqual({ state: "working", mood: "neutral", motion: null });
    // thinking keeps the at-work body, never the engine's three dots (#5415)
    expect(enginePose("idle", "thinking", "neutral")).toEqual({ state: "thinking", mood: "neutral", motion: "thinking" });
    expect(enginePose("idle", "thinking", "happy")).toEqual({ state: "thinking", mood: "happy", motion: "happy" });
    // a happy bot is happy in every state; a finished turn is happy as it was before
    expect(enginePose("idle", "waiting", "happy")).toEqual({ state: "waiting", mood: "happy", motion: null });
    expect(enginePose("working", "idle", "happy")).toEqual({ state: "idle", mood: "happy", motion: "happy" });
    expect(enginePose("idle", "done", "neutral")).toEqual({ state: "done", mood: "happy", motion: null });
  });

  it("hands mountAvatar a body for thinking, and the mood apart from the state (#5539, #5540)", () => {
    // thinking: idle + at-work lean, never the engine's three-dot state
    expect(mountPose(enginePose("idle", "thinking", "neutral"))).toEqual({ state: "idle", mood: "neutral", atWork: true });
    expect(mountPose(enginePose("idle", "thinking", "happy"))).toEqual({ state: "idle", mood: "happy", atWork: false });
    // working / waiting / blocked / done: the engine's own state, mood on top
    expect(mountPose(enginePose("idle", "working", "happy"))).toEqual({ state: "working", mood: "happy", atWork: false });
    expect(mountPose(enginePose("idle", "waiting", "neutral"))).toEqual({ state: "waiting", mood: "neutral", atWork: false });
    expect(mountPose(enginePose("idle", "blocked", "happy"))).toEqual({ state: "blocked", mood: "happy", atWork: false });
    expect(mountPose(enginePose("idle", "done", "neutral"))).toEqual({ state: "done", mood: "happy", atWork: false });
    // at rest the app's face stays (baked moods), mount gets idle
    expect(mountPose(enginePose("working", "idle", "neutral"))).toEqual({ state: "idle", mood: "neutral", atWork: true });
    expect(mountPose(enginePose("happy", "idle", "neutral"))).toEqual({ state: "idle", mood: "happy", atWork: false });
  });

  it("draws the engine's ribbons live, each piece with its ribbon's gradient", () => {
    const def = shapeDefinition("cup");
    let frame = avatarFrame(def, { state: "done", stateAge: 0.6, time: 0.6 });
    for (let t = 0.2; t < 6 && !frame.shapes.some((shape) => shape.kind === "ribbon"); t += 0.2) frame = avatarFrame(def, { state: "done", stateAge: t, time: t });
    const ribbons = frame.shapes.filter((shape) => shape.kind === "ribbon");
    expect(ribbons.length).toBeGreaterThan(0);
    const markup = shapesMarkup(frame.shapes, INK, "u-");
    expect(markup.match(/<linearGradient /g)?.length).toBe(ribbons.length);
    expect(markup).toContain('gradientUnits="userSpaceOnUse"');
    expect(markup).toContain('fill="url(#u-ribbon-0)"');
  });

  it("a skin never paints a mark as the body's face", () => {
    const def = shapeDefinition("cup");
    // the engine's thinking still has no face to paint; the app does not use it (#5415)
    expect(skinFace(stateStill(def, "thinking", "neutral"))).toBeNull();
    expect(skinFace(stateStill(def, "blocked", "neutral"))).toBeNull();
    expect(skinFace(stateStill(def, "waiting", "neutral"))).not.toBeNull();
    const html = renderToStaticMarkup(createElement(ShapeMascot, { shape: "cup", skin: "gold", color: "blue", size: 28, animated: false, agentState: "thinking" }));
    expect(html).toContain("data-shape-body");
    // thinking keeps the body, so a gold skin still finds a face (#5415)
    expect(html).toContain("data-skin-face");
  });

  it("a busy bot's sidebar still keeps the mascot body, never three dots (#5415)", () => {
    const html = draw({ bot: bot({ busy: true }) });
    expect(html).toContain('data-agent-state="thinking"');
    const url = stillOf(html);
    expect(url).toBeTruthy();
    // the at-work baked still (eyes present), not the engine's mark-only thinking frame
    expect(svgOf(url!)).toMatch(/<ellipse |<path /);
    expect(svgOf(url!)).not.toMatch(/mark-/);
    expect(stillOf(html)).toBe(stillUrl(`cup||thinking|${BLUE}|${INK}`, moodFrame(bakedStill("cup")!, "thinking"), BLUE, INK));
  });
});

describe("the look settings a person chose", () => {
  it("a happy bot has the engine's happy eyes at rest and in a state", () => {
    const happy = draw({ bot: bot({}, { mood: "happy" }) });
    expect(happy).toContain('data-mood="happy"');
    expect(stillOf(happy)).toBe(stillUrl(`cup||happy|${BLUE}|${INK}`, moodFrame(bakedStill("cup")!, "happy"), BLUE, INK));
    const waiting = draw({ bot: bot({ activity: "waiting-on-you" }, { mood: "happy" }) });
    expect(svgOf(stillOf(waiting)!)).toContain('stroke-linecap="round"');
    expect(svgOf(stillOf(draw({ bot: bot({ activity: "waiting-on-you" }) }))!)).not.toContain('stroke-linecap="round"');
  });

  it("paints the eyes in the colour chosen, over the skin's own ink", () => {
    expect(svgOf(stillOf(draw({ bot: bot() }))!)).toContain(`fill="${INK}"`);
    const blue = svgOf(stillOf(draw({ bot: bot({}, { eyeColor: "#ffffff" }) }))!);
    expect(blue).toContain('fill="#ffffff"');
    expect(blue).not.toContain(`fill="${INK}"`);
  });

  it("draws the body at the depth chosen, the Outline skin always flat", () => {
    const def = shapeDefinition("cup");
    const natural = stillOf(draw({ bot: bot() }));
    const deep = stillOf(draw({ bot: bot({}, { depth: 12 }) }));
    const flat = stillOf(draw({ bot: bot({}, { depth: 0 }) }));
    expect(deep).not.toBe(natural);
    expect(flat).not.toBe(natural);
    expect(deep).toBe(stillUrl(`${def.id}|12|idle|${BLUE}|${INK}`, moodFrame(runtimeStill(def, 12), "idle"), BLUE, INK));
    // the engine's natural depth, chosen by hand, is the baked still
    expect(stillOf(draw({ bot: bot({}, { depth: 6 }) }))).toBe(natural);
    const outline = (look: Record<string, unknown>) => draw({ bot: bot({}, { skins: { shape: "outline" }, ...look }) }).replace(/shape-[A-Za-z0-9_-]+/g, "uid");
    expect(outline({ depth: 12 })).toBe(outline({}));
  });

  it("says which material the bot wears, and draws flat where the engine's canvas is not there (no WebGL2)", () => {
    const fluffy = draw({ bot: bot({}, { material: "fluffy" }) });
    expect(fluffy).toContain('data-shape-material="fluffy"');
    // this page has no WebGL2: the flat still, the same picture as a flat bot
    expect(stillOf(fluffy)).toBe(stillOf(draw({ bot: bot() })));
    expect(fluffy).not.toContain("data-shape-canvas");
  });
});
