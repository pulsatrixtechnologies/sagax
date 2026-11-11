// #3624: an owl with nothing to draw costs no frame. Counted in frames run by
// the shared loop over a stretch of the frame clock, never in milliseconds.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOwlController, resetOwlLoopForTests, type OwlRigElements } from "./owl-loop";

/** A group whose style hands a transform back in the browser's spelling
 * ("0px, 0.5px"), as a real one does. */
function group() {
  let value = "";
  const style = {
    sets: 0,
    get transform() { return value; },
    set transform(next: string) { this.sets += 1; value = next.replace(/,(?! )/g, ", "); },
    opacity: "",
  };
  return { style } as unknown as SVGGElement & { style: { sets: number } };
}

/** The owl's svg: the attributes and the style the loop sets for a CSS motion. */
function svg() {
  const attributes = new Map<string, string>();
  return {
    attributes,
    style: { transformOrigin: "", setProperty() {} },
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    getAttribute: (name: string) => attributes.get(name) ?? null,
  };
}

/** The blinks a browser would run on the lids (Element.animate): each one
 * waits out its delay on the clock, then ends; nothing asks for a frame. */
const blinks: Array<{ delay: number; started: number; onfinish: (() => void) | null; canceled: boolean; paused: boolean }> = [];
function animatedGroup() {
  const lids = group();
  const animate = (_frames: Keyframe[], options: KeyframeAnimationOptions) => {
    const blink = {
      delay: Number(options.delay ?? 0), started: performance.now(), onfinish: null as (() => void) | null, canceled: false, paused: false,
      finished: Promise.resolve(),
      cancel() { blink.canceled = true; },
      pause() { blink.paused = true; },
      play() { blink.paused = false; },
    };
    blinks.push(blink);
    setTimeout(() => { if (!blink.canceled) blink.onfinish?.(); }, blink.delay + Number(options.duration ?? 0));
    return blink;
  };
  Object.assign(lids, { animate });
  return lids;
}

function rig(root?: ReturnType<typeof svg>, lids: ReturnType<typeof group> = group()) {
  const parts = { rig: group(), nearWing: group(), eyes: group(), pupil: group(), lids };
  if (root) Object.defineProperty(parts.rig, "ownerSVGElement", { value: root });
  return parts as unknown as OwlRigElements & Record<keyof typeof parts, { style: { sets: number } }>;
}

const frames: FrameRequestCallback[] = [];

/** Runs the loop for `ms` of clock at 60 Hz; returns the frames it ran. */
function play(ms: number): number {
  let ran = 0;
  for (let t = 0; t < ms; t += 16) {
    vi.advanceTimersByTime(16);
    for (const callback of frames.splice(0)) {
      ran += 1;
      callback(performance.now());
    }
  }
  return ran;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  // the first blink as late as it can be: 5 s after the first frame
  vi.spyOn(Math, "random").mockReturnValue(0.99);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  resetOwlLoopForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  frames.length = 0;
  blinks.length = 0;
});

describe("the owl loop with nothing to draw (#3624)", () => {
  it("lets a sidebar owl sleep until its next blink, and still blinks it", () => {
    const parts = rig();
    const owl = createOwlController(parts, { state: "idle", gazeOnly: true });
    play(1_000); // its eyes settle
    const sets = parts.pupil.style.sets + parts.lids.style.sets + parts.rig.style.sets;
    // the quiet stretch before the first blink: no frame, no write
    expect(play(3_500)).toBe(0);
    expect(parts.pupil.style.sets + parts.lids.style.sets + parts.rig.style.sets).toBe(sets);
    // the blink is still drawn, and the owl sleeps again after it
    expect(play(1_500)).toBeGreaterThan(5);
    expect(play(3_000)).toBe(0);
    owl.destroy();
  });

  it("wakes a sleeping sidebar owl when the pointer moves", () => {
    const owl = createOwlController(rig(), { state: "idle", gazeOnly: true });
    play(1_000);
    expect(play(1_000)).toBe(0);
    owl.setPointer({ x: 6, y: -4 });
    expect(play(200)).toBeGreaterThan(5);
    owl.destroy();
  });

  it("breathes at rest in CSS and draws no frame between blinks", () => {
    const root = svg();
    const owl = createOwlController(rig(root), { state: "idle", reducedMotion: false });
    play(2_500); // the eyes settle on their resting gaze
    expect(root.attributes.get("data-owl-motion")).toBe("breath");
    expect(play(2_000)).toBe(0);
    owl.destroy();
    expect(root.attributes.has("data-owl-motion")).toBe(false);
  });

  it("works in CSS: the bounce and the wing flap run no frame of script", () => {
    const root = svg();
    const owl = createOwlController(rig(root), { state: "working", reducedMotion: false });
    play(2_500);
    expect(root.attributes.get("data-owl-motion")).toBe("working");
    expect(play(2_000)).toBe(0);
    // back at rest, the svg breathes instead
    owl.setState("idle");
    play(100);
    expect(root.attributes.get("data-owl-motion")).toBe("breath");
    owl.destroy();
  });

  it("draws no frame in ten seconds of a quiet window, and every owl still blinks", () => {
    // the idle scene: a dozen sidebar owls following the pointer, and the
    // open bot's owl breathing in the header
    const sidebar = Array.from({ length: 12 }, () => createOwlController(rig(undefined, animatedGroup()), { state: "idle", gazeOnly: true }));
    const root = svg();
    const header = createOwlController(rig(root, animatedGroup()), { state: "idle", reducedMotion: false });
    play(2_500); // the eyes settle on their resting gaze
    expect(root.attributes.get("data-owl-motion")).toBe("breath");
    expect(play(10_000)).toBe(0);
    // each owl's blink ran on the lids as an animation, again and again
    expect(blinks.length).toBeGreaterThanOrEqual(13 * 2);
    expect(blinks.every((blink) => blink.delay >= 0)).toBe(true);
    // gone, each owl cancels the blink it was waiting on
    for (const owl of [...sidebar, header]) owl.destroy();
    expect(blinks.filter((blink) => blink.canceled)).toHaveLength(13);
  });

  it("hands the blink back to the script when the owl's lids are drawn by it (sleepy)", () => {
    const root = svg();
    const owl = createOwlController(rig(root, animatedGroup()), { state: "idle", reducedMotion: false });
    play(500);
    expect(blinks).toHaveLength(1);
    owl.setState("sleepy");
    play(100);
    expect(blinks).toHaveLength(1);
    expect(blinks[0]!.canceled).toBe(true);
    owl.destroy();
  });

  it("holds the waiting blink while the window is hidden, and lets it go when it shows", () => {
    // a document whose window can be hidden
    const page = Object.assign(new EventTarget(), { hidden: false, visibilityState: "visible", documentElement: { dataset: {} as Record<string, string> } });
    vi.stubGlobal("document", page);
    const show = (shown: boolean) => {
      Object.assign(page, { hidden: !shown, visibilityState: shown ? "visible" : "hidden" });
      page.dispatchEvent(new Event("visibilitychange"));
    };
    const owl = createOwlController(rig(undefined, animatedGroup()), { state: "idle", gazeOnly: true });
    play(500);
    expect(blinks).toHaveLength(1);
    show(false);
    expect(blinks[0]!.paused).toBe(true);
    show(true);
    expect(blinks[0]!.paused).toBe(false);
    owl.destroy();
  });

  it("keeps a working owl without an svg to hold its motion on the display rate", () => {
    const owl = createOwlController(rig(), { state: "working", reducedMotion: false });
    expect(play(1_000)).toBeGreaterThan(50);
    owl.destroy();
  });
});
