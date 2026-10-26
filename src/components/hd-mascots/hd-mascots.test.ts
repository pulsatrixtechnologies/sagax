// HD mascots: the manifest, the state mapping, the asset choice (loop or
// still), the fallback to the vector drawing, and the "HD mascots" switch.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { MAUS_STATES } from "@/lib/mascot";
import { hdMascotsChoice, hdMascotsEnabled, HD_MASCOTS_KEY, setHdMascotsEnabled } from "@/lib/hd-mascots-preference";
import { MASCOT_CHARACTERS } from "../../../shared/mascot-look";
import { isUserPreferenceKey } from "../../../shared/user-preferences";
import { BotAvatar } from "../Avatar";
import { HD_CHARACTERS, HD_LOOPS, HD_LOOP_MIN_PX, HD_MASCOTS, HD_STATE_MAP, HD_STILLS, hdAssetFor, hdKeyForActivity, hdKeyForState, hdManifestFor } from "./manifest";
import { HdMascot, hdSourceFor, markHdAsset, resetHdMascotCache } from "./HdMascot";
import { SHIBA_HD } from "./shiba-hd";

afterEach(() => {
  setHdMascotsEnabled(true);
  resetHdMascotCache();
});

const ASSETS = join(process.cwd(), "src/assets/mascots/shiba");

describe("HD mascot manifest", () => {
  it("ships HD art for Shiba only; every other character keeps its vector look", () => {
    expect(HD_CHARACTERS).toEqual(["shiba"]);
    for (const character of MASCOT_CHARACTERS) {
      expect(hdManifestFor(character) !== null, character).toBe(character === "shiba");
    }
    expect(hdManifestFor("trombi")).toBeNull();
    expect(hdManifestFor("shape")).toBeNull();
    expect(hdManifestFor(undefined)).toBeNull();
    expect(hdManifestFor("toString")).toBeNull();
  });

  it("names every loop and still, and each loop has a still to fall back on", () => {
    const shiba = HD_MASCOTS.shiba!;
    expect(Object.keys(shiba.loops).sort()).toEqual([...HD_LOOPS].sort());
    expect(Object.keys(shiba.stills).sort()).toEqual([...HD_STILLS].sort());
    for (const loop of HD_LOOPS) expect(HD_STILLS).toContain(shiba.loopStill[loop]);
    for (const url of [...Object.values(shiba.loops), ...Object.values(shiba.stills)]) expect(url).toMatch(/\.webp/);
  });

  it("keeps the shipped files small and present (animated WebP loops, WebP stills)", () => {
    const files = [...HD_LOOPS.map((loop) => `loop-${loop}.webp`), ...HD_STILLS.map((still) => `still-${still.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}.webp`)];
    let total = 0;
    for (const file of files) {
      const path = join(ASSETS, file);
      expect(existsSync(path), file).toBe(true);
      total += statSync(path).size;
    }
    expect(total).toBeLessThan(8 * 1024 * 1024);
  });

  it("repeats every loop forever but the sad one, which plays once and rests lying down", () => {
    // the ANIM chunk of an animated WebP: background color (4 bytes), then the loop count (0 = forever)
    const loopCount = (file: string) => {
      const bytes = readFileSync(join(ASSETS, file));
      const at = bytes.indexOf("ANIM", 12, "latin1");
      expect(at, `${file} is animated`).toBeGreaterThan(0);
      return bytes.readUInt16LE(at + 12);
    };
    for (const loop of HD_LOOPS) expect(loopCount(`loop-${loop}.webp`), loop).toBe(loop === "sad" ? 1 : 0);
  });
});

describe("HD state mapping", () => {
  it("maps every app state", () => {
    for (const state of MAUS_STATES) expect(HD_STATE_MAP[state], state).toBeDefined();
    expect(Object.keys(HD_STATE_MAP).sort()).toEqual([...MAUS_STATES].sort());
  });

  it("plays the clips for idle, happy, sad and a celebration, and the closest still for the other moods", () => {
    expect(hdKeyForState("idle")).toEqual({ loop: "idle" });
    expect(hdKeyForState(undefined)).toEqual({ loop: "idle" });
    expect(hdKeyForState("not-a-state")).toEqual({ loop: "idle" });
    expect(hdKeyForState("happy")).toEqual({ loop: "happy" });
    expect(hdKeyForState("excited")).toEqual({ loop: "happy" });
    expect(hdKeyForState("sad")).toEqual({ loop: "sad" });
    expect(hdKeyForState("celebrate")).toEqual({ loop: "jump" });
    expect(hdKeyForState("thinking")).toEqual({ still: "thinking" });
    expect(hdKeyForState("writing")).toEqual({ still: "thinking" });
    expect(hdKeyForState("listening")).toEqual({ still: "neutral" });
    expect(hdKeyForState("searching")).toEqual({ still: "lookRight" });
    expect(hdKeyForState("suspicious")).toEqual({ still: "sit" });
    expect(hdKeyForState("scared")).toEqual({ still: "surprised" });
    expect(hdKeyForState("bored")).toEqual({ still: "sleepy" });
    expect(hdKeyForState("proud")).toEqual({ still: "front" });
    expect(hdKeyForState("shy")).toEqual({ still: "love" });
    expect(hdKeyForState("playful")).toEqual({ still: "wave" });
    expect(hdKeyForState("sleeping")).toEqual({ still: "sleepy" });
  });

  it("maps the desktop clips: walking, jumping and turning play their clips; sleep wins", () => {
    expect(hdKeyForActivity("idle")).toEqual({ loop: "idle" });
    expect(hdKeyForActivity("walk")).toEqual({ loop: "walk" });
    expect(hdKeyForActivity("fly")).toEqual({ loop: "walk" });
    expect(hdKeyForActivity("jump")).toEqual({ loop: "jump" });
    expect(hdKeyForActivity("celebrate")).toEqual({ loop: "jump" });
    expect(hdKeyForActivity("turn")).toEqual({ loop: "turn" });
    expect(hdKeyForActivity("turnCircles")).toEqual({ loop: "turn" });
    expect(hdKeyForActivity("sad")).toEqual({ loop: "sad" });
    expect(hdKeyForActivity("excited")).toEqual({ loop: "happy" });
    expect(hdKeyForActivity("walk", "sleep")).toEqual({ still: "sleepy" });
    // idle while the bot works or speaks: the pose decides
    expect(hdKeyForActivity("idle", "think")).toEqual({ still: "thinking" });
    expect(hdKeyForActivity("idle", "celebrate")).toEqual({ loop: "jump" });
    // a clip without art falls back on the pose
    expect(hdKeyForActivity("preen", "idle")).toEqual({ loop: "idle" });
    expect(hdKeyForActivity("preen", "alert")).toEqual({ still: "surprised" });
  });
});

describe("HD asset choice", () => {
  it("plays a loop only when it may move and the box is large enough", () => {
    const loop = hdAssetFor(SHIBA_HD, { loop: "happy" }, { moving: true, size: 96 });
    expect(loop).toMatchObject({ kind: "loop", src: SHIBA_HD.loops.happy, still: SHIBA_HD.stills.happy, id: "happy" });
    // reduced motion, or a thumbnail: the still
    expect(hdAssetFor(SHIBA_HD, { loop: "happy" }, { moving: false, size: 96 })).toMatchObject({ kind: "still", src: SHIBA_HD.stills.happy });
    expect(hdAssetFor(SHIBA_HD, { loop: "walk" }, { moving: true, size: HD_LOOP_MIN_PX - 1 })).toMatchObject({ kind: "still", src: SHIBA_HD.stills.walk });
    expect(hdAssetFor(SHIBA_HD, { still: "angry" }, { moving: true, size: 96 })).toMatchObject({ kind: "still", src: SHIBA_HD.stills.angry, id: "angry" });
  });

  it("falls back from a failed loop to its still, then to the vector drawing", () => {
    const asset = hdAssetFor(SHIBA_HD, { loop: "idle" }, { moving: true, size: 96 });
    const failed = new Set<string>();
    expect(hdSourceFor(asset, (url) => failed.has(url))).toBe(SHIBA_HD.loops.idle);
    failed.add(SHIBA_HD.loops.idle);
    expect(hdSourceFor(asset, (url) => failed.has(url))).toBe(SHIBA_HD.stills.neutral);
    failed.add(SHIBA_HD.stills.neutral);
    expect(hdSourceFor(asset, (url) => failed.has(url))).toBeNull();
  });
});

const vector = createElement("span", { "data-vector": "" });

describe("HdMascot", () => {
  it("shows the vector drawing in the same box while the art loads, and loads the art lazily behind it", () => {
    const html = renderToStaticMarkup(createElement(HdMascot, { manifest: SHIBA_HD, hdKey: { loop: "idle" }, size: 96, fallback: vector }));
    expect(html).toContain('data-hd="loading"');
    expect(html).toContain("data-vector");
    expect(html).toContain('style="width:96px;height:96px"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain(`src="${SHIBA_HD.loops.idle}"`);
  });

  it("draws the art straight away once it has loaded", () => {
    markHdAsset(SHIBA_HD.loops.happy, "loaded");
    const html = renderToStaticMarkup(createElement(HdMascot, { manifest: SHIBA_HD, hdKey: { loop: "happy" }, size: 96, fallback: vector, label: "Rex" }));
    expect(html).toContain('data-hd="ready"');
    expect(html).not.toContain("data-vector");
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Rex"');
  });

  it("keeps the vector drawing for good when the art fails", () => {
    markHdAsset(SHIBA_HD.loops.sad, "failed");
    markHdAsset(SHIBA_HD.stills.sad, "failed");
    const html = renderToStaticMarkup(createElement(HdMascot, { manifest: SHIBA_HD, hdKey: { loop: "sad" }, size: 96, fallback: vector }));
    expect(html).toContain('data-hd="fallback"');
    expect(html).toContain("data-vector");
    expect(html).not.toContain("<img");
  });

  it("draws a still, not a loop, for a thumbnail", () => {
    const html = renderToStaticMarkup(createElement(HdMascot, { manifest: SHIBA_HD, hdKey: { loop: "idle" }, size: 96, animated: false, fallback: vector }));
    expect(html).toContain('data-hd-kind="still"');
    expect(html).toContain(`src="${SHIBA_HD.stills.neutral}"`);
  });
});

describe("HD mascots switch", () => {
  it("is on by default, kept under its own key, and travels with the person's preferences", () => {
    expect(hdMascotsEnabled()).toBe(true);
    expect(hdMascotsChoice.key).toBe(HD_MASCOTS_KEY);
    expect(isUserPreferenceKey(HD_MASCOTS_KEY)).toBe(true);
  });

  it("on: a Shiba bot shows its HD art; other characters are unchanged", () => {
    const shiba = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "orange", mascotLook: { character: "shiba" } }, size: 64, state: "happy" }));
    expect(shiba).toContain('class="hd-mascot');
    expect(shiba).toContain('data-hd-asset="happy"');
    // the vector Shiba stands in while the art loads
    expect(shiba).toContain('data-shiba-skin="plain"');
    const grump = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "orange", mascotLook: { character: "grump" } }, size: 64, state: "happy" }));
    expect(grump).not.toContain("hd-mascot");
    const trombi = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "orange", mascotLook: { character: "trombi" } }, size: 64 }));
    expect(trombi).not.toContain("hd-mascot");
  });

  it("off: the classic vector Shiba everywhere", () => {
    setHdMascotsEnabled(false);
    expect(hdMascotsEnabled()).toBe(false);
    markHdAsset(SHIBA_HD.loops.happy, "loaded");
    const html = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "orange", mascotLook: { character: "shiba", skins: { shiba: "sesame" } } }, size: 64, state: "happy" }));
    expect(html).not.toContain("hd-mascot");
    expect(html).toContain('data-shiba-skin="sesame"');
  });
});
