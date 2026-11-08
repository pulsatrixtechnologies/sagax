import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-dom", () => ({ flushSync: (run: () => void) => run() }));

const { navigate, swapStandsStill } = await import("./view-transitions");

type Listener = () => void;
function fakeTransition() {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  return { finished, updateCallbackDone: Promise.resolve(), ready: Promise.resolve(), skipTransition: vi.fn(() => finish()), finish, types: new Set<string>() };
}

describe("navigate", () => {
  let dataset: Record<string, string>;
  let listeners: Map<string, Listener>;
  let reduced: boolean;
  let started: Array<{ update: () => void; types: string[] }>;
  let transitions: ReturnType<typeof fakeTransition>[];

  beforeEach(() => {
    dataset = {};
    listeners = new Map();
    reduced = false;
    started = [];
    transitions = [];
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: reduced }),
      addEventListener: (type: string, run: Listener) => listeners.set(type, run),
      removeEventListener: (type: string) => listeners.delete(type),
    });
    vi.stubGlobal("document", {
      visibilityState: "visible",
      documentElement: { dataset },
      startViewTransition: (options: { update: () => void; types: string[] }) => {
        started.push(options);
        const transition = fakeTransition();
        transitions.push(transition);
        // the browser runs the update once the old frame is captured
        queueMicrotask(options.update);
        return transition;
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a page change runs the update inside a transition typed by direction and scope, and marks the root while it plays", async () => {
    const update = vi.fn();
    navigate(update, "back", "page");
    expect(update).not.toHaveBeenCalled();
    expect(started[0].types).toEqual(["nav-back", "nav-page"]);
    expect(dataset).toEqual({ nav: "page", navDirection: "back" });
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(1);
    transitions[0].finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dataset).toEqual({});
  });

  it("never holds input: a pointer, wheel or key press skips to the new state", () => {
    navigate(vi.fn(), "forward", "page");
    for (const type of ["pointerdown", "wheel", "keydown"]) expect(listeners.has(type)).toBe(true);
    listeners.get("pointerdown")!();
    expect(transitions[0].skipTransition).toHaveBeenCalled();
  });

  it("a second navigation skips the first", () => {
    navigate(vi.fn(), "forward", "page");
    navigate(vi.fn(), "forward", "page");
    expect(transitions[0].skipTransition).toHaveBeenCalled();
    expect(dataset.nav).toBe("page");
  });

  it("updates at once under reduced motion, without the API, or in a hidden window", () => {
    reduced = true;
    const first = vi.fn();
    navigate(first, "forward", "page");
    expect(first).toHaveBeenCalledTimes(1);
    reduced = false;
    (document as { visibilityState: string }).visibilityState = "hidden";
    const second = vi.fn();
    navigate(second, "forward", "page");
    expect(second).toHaveBeenCalledTimes(1);
    vi.stubGlobal("document", { visibilityState: "visible", documentElement: { dataset } });
    const third = vi.fn();
    navigate(third, "forward", "page");
    expect(third).toHaveBeenCalledTimes(1);
    expect(started).toEqual([]);
  });

  describe("a main column swap (#2755)", () => {
    let frame: { width: number; height: number; room: boolean };
    let animations: Array<{ keyframes: Keyframe[]; options: KeyframeAnimationOptions; cancel: ReturnType<typeof vi.fn> }>;
    beforeEach(() => {
      frame = { width: 1000, height: 800, room: false };
      animations = [];
      const column = {
        getBoundingClientRect: () => ({ width: frame.width, height: frame.height }),
        querySelector: (inner: string) => (inner === "[data-room-view]" && frame.room ? {} : null),
        animate: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
          const animation = { keyframes, options, cancel: vi.fn(), finished: new Promise(() => {}) };
          animations.push(animation);
          return animation;
        },
      };
      Object.assign(document as object, { querySelector: (selector: string) => (selector === ".app-content-frame" ? column : null) });
    });

    it("draws the new view at once, with no view transition, then slides only it in from the direction of travel", () => {
      const update = vi.fn();
      navigate(update);
      expect(update).toHaveBeenCalledTimes(1);
      expect(started).toEqual([]);
      expect(dataset).toEqual({});
      expect(animations[0].keyframes[0]).toEqual({ opacity: 0, transform: "translateX(8px)" });
      expect(animations[0].options.duration).toBe(200);
      navigate(vi.fn(), "back");
      expect(animations[1].keyframes[0]).toEqual({ opacity: 0, transform: "translateX(-8px)" });
    });

    it("a second swap cancels the first one's slide", () => {
      navigate(vi.fn());
      navigate(vi.fn());
      expect(animations[0].cancel).toHaveBeenCalled();
      expect(animations).toHaveLength(2);
    });

    it("never animates under reduced motion or in a hidden window", () => {
      reduced = true;
      navigate(vi.fn());
      reduced = false;
      (document as { visibilityState: string }).visibilityState = "hidden";
      navigate(vi.fn());
      expect(animations).toEqual([]);
    });

    it("opening or leaving a room, or a column that changes size, stands still", () => {
      navigate(() => { frame = { ...frame, room: true }; });
      navigate(() => { frame = { ...frame, room: false }; });
      navigate(() => { frame = { ...frame, width: 640 }; });
      expect(animations).toEqual([]);
      // 1:1 to 1:1, same box: it slides in
      navigate(() => {});
      expect(animations).toHaveLength(1);
    });
  });

  it("swapStandsStill: a room on either side, or a resized column; a same-size 1:1 swap may animate", () => {
    const chat = { width: 1000, height: 800, room: false };
    expect(swapStandsStill(chat, chat)).toBe(false);
    expect(swapStandsStill(chat, { ...chat, room: true })).toBe(true);
    expect(swapStandsStill({ ...chat, room: true }, chat)).toBe(true);
    expect(swapStandsStill({ ...chat, width: 640 }, chat)).toBe(true);
    expect(swapStandsStill(chat, { ...chat, height: 700 })).toBe(true);
    expect(swapStandsStill(null, chat)).toBe(false);
  });

  it("a room's column carries the marker the rule reads", () => {
    const group = readFileSync(new URL("../components/GroupView.tsx", import.meta.url), "utf8");
    // <main> in the window, <section> in a section of the split view (#1504)
    expect(group).toContain('const Root = pane ? "section" : "main";');
    expect(group).toMatch(/<Root data-room-view=""(?: data-[\w-]+="")* className="app-glow relative flex h-full/);
  });

  it("the in-app reduced-motion switch stops every animation and smooth scroll, as the system setting does", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(css).toMatch(/:root\[data-reduced-motion="true"\] \*,\n:root\[data-reduced-motion="true"\] \*::before,\n:root\[data-reduced-motion="true"\] \*::after \{\n  animation: none !important;\n  transition-duration: 0\.01ms !important;\n  transition-delay: 0ms !important;\n  scroll-behavior: auto !important;/);
  });

  it("the CSS names only the main column, takes no pointer events and stands still under reduced motion", () => {
    // A Windows checkout can hand the file over with CRLF line ends.
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(css).toContain('html[data-nav="main"] .app-content-frame {\n  view-transition-name: main-view;');
    expect(css).toMatch(/::view-transition \{\s*pointer-events: none;/);
    expect(css).toContain('html[data-nav-direction="back"]::view-transition-new(main-view)');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*::view-transition-group\(\*\),\s*::view-transition-old\(\*\),\s*::view-transition-new\(\*\) \{\s*animation: none !important;/);
  });

  it("main view switches go through it: a conversation or thread from the sidebar or the palette, ⌘1-9 and ⌘⇧[ ], closing Settings", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const sidebar = read("../components/Sidebar.tsx");
    expect(sidebar).toContain("const openConversation = () => navigate(() => {");
    // a thread row: the switch (or the plain select of the open thread) runs inside navigate
    expect(sidebar).toMatch(/onSelect: \(task: Row\) => navigate\(\(\) => \{ if \(task\.threadId !== latest\.current\.threadId\) dispatch\(\{ type: "switchTask", botId, threadId: task\.threadId \}\);/);
    expect(sidebar).toContain('onClick={() => navigate(() => dispatch({ type: "select", id: group.id }))}');
    expect(read("../components/CommandPalette.tsx")).toContain("navigate(() => openBot(dispatch, action.bot, showThreads))");
    const shellNav = read("../App.tsx-parts/useShellNavigation.ts");
    expect(shellNav).toContain("navigate(() => openBot(dispatch, target, showThreads))");
    expect(shellNav).toContain('navigate(() => openBot(dispatch, next, showThreads), e.key === "]" ? "forward" : "back")');
    const settings = [
      read("../components/SettingsModal.tsx"),
      read("../components/settings/useSettingsModal.ts"),
    ].join("\n");
    expect(settings).toContain('navigate(() => dispatch({ type: "toggleAppSettings", open: false }), "back", "page")');
    expect(settings).toContain("starting:scale-98 starting:opacity-0");
  });
});
