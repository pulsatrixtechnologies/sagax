import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { animateSidebarSnap, SIDEBAR_SNAP_MS, sidebarSnapFrames } from "./sidebar-motion";
import { EASE } from "./motion";

describe("the sidebar snap", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("expanding: the column slides from the rail's edge, the new sidebar is revealed from the rail's width", () => {
    expect(sidebarSnapFrames(80, 300, "#111")).toEqual({
      sidebar: [{ clipPath: "inset(0px 220px 0px 0px)" }, { clipPath: "inset(0px 0px 0px 0px)" }],
      follower: [{ transform: "translateX(-220px)" }, { transform: "translateX(0px)" }],
    });
  });

  it("collapsing: the column slides back to the rail, the rail's colour fills the strip it has not crossed yet", () => {
    expect(sidebarSnapFrames(300, 80, "#111")).toEqual({
      sidebar: [{ boxShadow: "110px 0px 0px 110px #111" }, { boxShadow: "0px 0px 0px 0px #111" }],
      follower: [{ transform: "translateX(220px)" }, { transform: "translateX(0px)" }],
    });
  });

  it("animates transforms, clip and paint only, never a layout property", () => {
    for (const frames of [sidebarSnapFrames(80, 320, "red"), sidebarSnapFrames(320, 80, "red")]) {
      const properties = [...frames!.sidebar, ...frames!.follower].flatMap((frame) => Object.keys(frame));
      expect(properties.every((property) => ["transform", "clipPath", "boxShadow"].includes(property))).toBe(true);
    }
    expect(sidebarSnapFrames(240, 240, "red")).toBeNull();
  });

  it("plays 200ms ease-out-quint, marks the sidebar only while it plays and puts the row's overflow back", async () => {
    vi.stubGlobal("document", { documentElement: { dataset: {} } });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal("getComputedStyle", () => ({ backgroundColor: "rgb(1, 2, 3)" }));
    const calls: Array<{ frames: Keyframe[]; timing: KeyframeAnimationOptions }> = [];
    let settle!: () => void;
    const finished = new Promise<void>((resolve) => (settle = resolve));
    const animate = (frames: Keyframe[], timing: KeyframeAnimationOptions) => {
      calls.push({ frames, timing });
      return { finished, cancel: vi.fn() };
    };
    const attributes = new Set<string>();
    const row = { style: { overflow: "" } };
    const sidebar = {
      parentElement: row,
      animate,
      setAttribute: (name: string) => attributes.add(name),
      removeAttribute: (name: string) => attributes.delete(name),
    } as unknown as HTMLElement;
    const follower = { animate } as unknown as HTMLElement;
    animateSidebarSnap(sidebar, follower, 300, 80);
    expect(calls).toHaveLength(2);
    expect(calls.every(({ timing }) => timing.duration === SIDEBAR_SNAP_MS && timing.easing === EASE.outQuint)).toBe(true);
    expect(SIDEBAR_SNAP_MS).toBe(200);
    expect(attributes.has("data-sidebar-animating")).toBe(true);
    expect(row.style.overflow).toBe("clip");
    settle();
    await finished;
    await Promise.resolve();
    expect(attributes.has("data-sidebar-animating")).toBe(false);
    expect(row.style.overflow).toBe("");
  });

  it("does nothing under reduced motion", () => {
    vi.stubGlobal("document", { documentElement: { dataset: { reducedMotion: "true" } } });
    const animate = vi.fn();
    animateSidebarSnap({ animate } as unknown as HTMLElement, null, 300, 80);
    expect(animate).not.toHaveBeenCalled();
  });

  it("the sidebar no longer transitions its width", () => {
    const source = readFileSync(new URL("../components/Sidebar.tsx", import.meta.url), "utf8");
    const hook = readFileSync(new URL("../components/Sidebar.tsx-parts/useSidebarWidth.ts", import.meta.url), "utf8");
    expect(source).not.toContain("transition-[width]");
    // 0db3d586d moved the animation into the sidebar's width hook.
    expect(source).toContain('import { useSidebarWidth } from "./Sidebar.tsx-parts/useSidebarWidth"');
    expect(source).toContain("useSidebarWidth({ sidebarRef })");
    expect(hook).not.toContain("transition-[width]");
    expect(hook).toContain("animateSidebarSnap(");
  });
});

describe("no layout property animates where a transform or a clip does the job", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

  it("the group call's member cards transition what they change, not everything", () => {
    // the member cards moved to GroupCallStage when GroupCall was split (#1383)
    const view = read("../components/GroupCallView.tsx");
    const stage = read("../components/GroupCallView.tsx-parts/GroupCallStage.tsx");
    expect(view).not.toContain("transition-all");
    expect(stage).not.toContain("transition-all");
    expect(stage).toContain("transition-[scale,opacity,background-color,box-shadow]");
  });

  it("the composer's mic slot snaps its width and fades its button; the level meter scales", async () => {
    const source = read("../components/ComposerControls.tsx");
    expect(source).not.toMatch(/transition-\[width|transition-\[height/);
    const { levelBarScale } = await import("../components/ComposerControls");
    expect(levelBarScale(0)).toBeCloseTo(3 / 13);
    expect(levelBarScale(1)).toBe(1);
    expect(levelBarScale(2)).toBe(1);
  });

  it("progress fills grow by their clip, not their width", () => {
    for (const path of ["../components/widget/WidgetContent.tsx", "../components/voice-mode/VoiceModeSettingsPanel.tsx"]) {
      const source = read(path);
      expect(source).not.toContain("transition-[width]");
      expect(source).toContain("progressClip(");
    }
  });
});

describe("sidebar thread rows off screen cost nothing", () => {
  it("each row skips layout and paint until it nears the view, with a remembered height", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    const rule = css.match(/\[data-sidebar\] \.group\\\/thread \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("content-visibility: auto;");
    expect(rule).toContain("contain-intrinsic-block-size: auto 32px;");
    // the row the rule targets is still the thread row's own box
    const row = readFileSync(new URL("../components/SidebarThreadRow.tsx", import.meta.url), "utf8");
    expect(row).toContain('"group/thread relative flex min-w-0 items-center rounded-lg"');
  });
});
