import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EMPTY_ONBOARDING } from "./onboarding";
import { ANCHOR_EFFECTS, currentStep, stepNumber, TOUR_STEPS, tourInProgress, withTourFinished, withTourReset } from "./guided-tour";

const withDone = (ids: string[]) => ({ ...EMPTY_ONBOARDING, hintsSeen: ids });
const step = (id: string) => TOUR_STEPS.find((s) => s.id === id)!;

describe("guided tour", () => {
  it("starts at the composer and ends back on the chat", () => {
    expect(currentStep(undefined)?.id).toBe("tour.composer");
    expect(TOUR_STEPS.at(-1)?.id).toBe("tour.done");
    expect(TOUR_STEPS.at(-1)?.anchor).toBe("composer");
  });

  it("resumes at the first unfinished step", () => {
    expect(currentStep(withDone(["tour.composer", "tour.model"]))?.id).toBe("tour.computer");
    expect(currentStep(withDone(TOUR_STEPS.map((s) => s.id)))).toBeNull();
    expect(currentStep(withDone(["spot.composer"]))?.id).toBe("tour.composer");
  });

  it("counts a tour as in progress only once a step is done and not all of them", () => {
    expect(tourInProgress(undefined)).toBe(false);
    expect(tourInProgress(withDone([]))).toBe(false);
    expect(tourInProgress(withDone(["spot.composer"]))).toBe(false);
    expect(tourInProgress(withDone(["tour.composer"]))).toBe(true);
    expect(tourInProgress(withDone(TOUR_STEPS.map((s) => s.id)))).toBe(false);
  });

  it("numbers steps without counting the closing card", () => {
    expect(stepNumber(TOUR_STEPS[0]!)).toEqual({ current: 1, total: TOUR_STEPS.length - 1 });
    expect(stepNumber(TOUR_STEPS.at(-1)!).current).toBe(TOUR_STEPS.length - 1);
  });

  it("resets and finishes without touching other hints", () => {
    const record = withDone(["spot.approval", "tour.composer"]);
    expect(withTourReset(record)).toEqual(["spot.approval"]);
    const finished = withTourFinished(record);
    expect(finished).toContain("spot.approval");
    for (const s of TOUR_STEPS) expect(finished).toContain(s.id);
    expect(new Set(finished).size).toBe(finished.length);
  });

  it("goes through the Tools menu rather than straight to the pages", () => {
    expect(step("tour.tools").onExit).toBe("openTools");
    expect(step("tour.apps").onExit).toBe("openApps");
    expect(step("tour.automations").onEnter).toBe("openTools");
    expect(step("tour.automations").onExit).toBe("openAutomations");
    for (const s of TOUR_STEPS.filter((x) => x.anchor?.startsWith("nav-"))) expect(s.skipIfMissing).toBe(true);
  });

  it("rebuilds the scene on enter so a reload mid-tour resumes cleanly", () => {
    expect(step("tour.computer-browser").onEnter).toBe("openComputer");
    expect(step("tour.computer-browser").fallbackAnchor).toBe("computer-tabs");
    expect(step("tour.apps").onEnter).toBe("openTools");
    expect(step("tour.apps-panel").onEnter).toBe("openApps");
    expect(step("tour.automations-page").onEnter).toBe("openAutomations");
  });

  it("closes everything it opened and returns to the chat", () => {
    expect(step("tour.computer").onExit).toBe("openComputer");
    expect(step("tour.computer-browser").onExit).toBe("closeComputer");
    expect(step("tour.apps-panel").onExit).toBe("closeApps");
    expect(step("tour.automations-page").onExit).toBe("backToChat");
  });

  it("skips the Computer step when its header control is absent (Refs #2000)", () => {
    expect(step("tour.computer").anchor).toBe("computer");
    expect(step("tour.computer").skipIfMissing).toBe(true);
  });

  it("resolves every tour anchor in desktop source (Refs #2000)", () => {
    const root = join(import.meta.dirname, "..");
    const blobs: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "locales" || name === "gallery") continue;
        const path = join(dir, name);
        const st = statSync(path);
        if (st.isDirectory()) walk(path);
        else if (/\.(tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name)) blobs.push(readFileSync(path, "utf8"));
      }
    };
    walk(root);
    const src = blobs.join("\n");
    const ids = new Set<string>();
    for (const s of TOUR_STEPS) {
      if (s.anchor) ids.add(s.anchor);
      if (s.fallbackAnchor) ids.add(s.fallbackAnchor);
    }
    // The header has no Computer button (the owner 2026-11-05): its step skips.
    // Other skipIfMissing anchors may still be absent until their panels open.
    expect(src).not.toContain('data-tour="computer"');
    for (const id of ids) {
      const step = TOUR_STEPS.find((s) => s.anchor === id || s.fallbackAnchor === id)!;
      const present = src.includes(`data-tour="${id}"`) || src.includes(`tourId: "${id}"`) || src.includes(`"data-tour": "${id}"`);
      if (!step.skipIfMissing) expect(present, id).toBe(true);
    }
  });

  it("knows which effects the control's own click performs", () => {
    for (const s of TOUR_STEPS) {
      if (s.onExit && ANCHOR_EFFECTS.has(s.onExit)) expect(s.anchor).not.toBeNull();
    }
    expect(ANCHOR_EFFECTS.has("closeApps")).toBe(false);
  });
});
