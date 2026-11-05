import { afterEach, describe, expect, it } from "vitest";

import {
  builtInPageTargets,
  listPageTargets,
  matchPageTargetChoice,
  pageTargetAutoResult,
  pageTargetCardResult,
  pageTargetQuestionOptions,
  parsePageTargetDefault,
  registerPageTarget,
  resetPageTargetRegistry,
  resolvePageTargets,
  shouldShowPageTargetCard,
} from "./page-targets.ts";

afterEach(() => {
  resetPageTargetRegistry();
});

describe("page target registry", () => {
  it("lists the built-in Sagax and Claude targets", () => {
    const ids = builtInPageTargets().map((row) => row.id);
    expect(ids).toEqual(["sagax_page", "sagax_artifact", "claude_artifact"]);
    expect(listPageTargets().map((row) => row.tool)).toEqual([
      "propose_page",
      "save_artifact",
      "claude_artifact",
    ]);
  });

  it("registers an extra target without a hard-coded UI list", () => {
    registerPageTarget({
      id: "wren_canvas",
      tool: "publish_wren_canvas",
      icon: "box",
      name: "Wren canvas",
      description: "Team canvas for Osprey reviews.",
      intents: ["page", "any"],
    });
    expect(listPageTargets().some((row) => row.id === "wren_canvas")).toBe(true);
    const resolved = resolvePageTargets({ intent: "page", availability: { pages: true, artifacts: true, claudeArtifacts: false } });
    expect(resolved.available.map((row) => row.id)).toContain("wren_canvas");
  });
});

describe("availability filtering", () => {
  it("keeps only targets that are available for this bot and person", () => {
    const resolved = resolvePageTargets({
      intent: "any",
      availability: {
        pages: true,
        artifacts: true,
        claudeArtifacts: false,
        claudeReason: "Claude is not signed in for this person.",
      },
    });
    expect(resolved.available.map((row) => row.id)).toEqual(["sagax_page", "sagax_artifact"]);
    expect(resolved.unavailable).toEqual([
      expect.objectContaining({
        id: "claude_artifact",
        available: false,
        reason: "Claude is not signed in for this person.",
      }),
    ]);
  });

  it("filters by intent so an artifact request skips propose_page", () => {
    const resolved = resolvePageTargets({
      intent: "artifact",
      availability: { pages: true, artifacts: true, claudeArtifacts: true },
    });
    expect(resolved.available.map((row) => row.id)).toEqual(["sagax_artifact", "claude_artifact"]);
  });

  it("honours per-id extra overrides for registered targets", () => {
    registerPageTarget({
      id: "wren_canvas",
      tool: "publish_wren_canvas",
      icon: "box",
      name: "Wren canvas",
      description: "Team canvas.",
    });
    const resolved = resolvePageTargets({
      availability: { extra: { wren_canvas: { available: false, reason: "Org policy." } } },
    });
    expect(resolved.unavailable.find((row) => row.id === "wren_canvas")?.reason).toBe("Org policy.");
  });
});

describe("card shown or omitted", () => {
  it("skips the card when only one target is available", () => {
    const resolved = resolvePageTargets({
      availability: { pages: true, artifacts: false, claudeArtifacts: false },
    });
    expect(resolved.auto).toMatchObject({ id: "sagax_page", tool: "propose_page" });
    expect(resolved.autoReason).toBe("single");
    expect(shouldShowPageTargetCard(resolved)).toBe(false);
    expect(pageTargetAutoResult(resolved.auto!, "single")).toContain("propose_page");
  });

  it("skips the card when the bot default is still available", () => {
    const resolved = resolvePageTargets({
      availability: { pages: true, artifacts: true, claudeArtifacts: true },
      defaultId: "sagax_artifact",
    });
    expect(resolved.auto).toMatchObject({ id: "sagax_artifact" });
    expect(resolved.autoReason).toBe("default");
    expect(shouldShowPageTargetCard(resolved)).toBe(false);
  });

  it("shows the card when two or more targets are available and no default fits", () => {
    const resolved = resolvePageTargets({
      availability: { pages: true, artifacts: true, claudeArtifacts: false },
      defaultId: "claude_artifact",
    });
    expect(resolved.auto).toBeUndefined();
    expect(shouldShowPageTargetCard(resolved)).toBe(true);
    expect(pageTargetCardResult(resolved.available)).toContain("sagax_page→propose_page");
  });

  it("ignores a default that is no longer available", () => {
    const resolved = resolvePageTargets({
      availability: { pages: true, artifacts: false, claudeArtifacts: true },
      defaultId: "sagax_artifact",
    });
    expect(shouldShowPageTargetCard(resolved)).toBe(true);
    expect(resolved.available.map((row) => row.id)).toEqual(["sagax_page", "claude_artifact"]);
  });
});

describe("choice options and routing", () => {
  it("builds question options with id, name and description", () => {
    const resolved = resolvePageTargets({
      availability: { pages: true, artifacts: true, claudeArtifacts: false },
    });
    expect(pageTargetQuestionOptions(resolved.available)).toEqual([
      {
        label: "Sagax page",
        description: "Shareable link the person publishes; others can open it outside Sagax.",
        id: "sagax_page",
        icon: "file-text",
      },
      {
        label: "Sagax artifact",
        description: "Kept inside Sagax for this person; can refresh itself, no public link.",
        id: "sagax_artifact",
        icon: "layout-dashboard",
      },
    ]);
  });

  it("can include unavailable rows with the reason as description", () => {
    const resolved = resolvePageTargets({
      availability: { pages: true, artifacts: true, claudeArtifacts: false, claudeReason: "Not signed in." },
    });
    const options = pageTargetQuestionOptions([...resolved.available, ...resolved.unavailable], true);
    expect(options.find((row) => row.id === "claude_artifact")).toMatchObject({
      disabled: true,
      description: "Not signed in.",
    });
  });

  it("matches a pick by id, name or tool for routing", () => {
    const offers = resolvePageTargets({
      availability: { pages: true, artifacts: true, claudeArtifacts: true },
    }).available;
    expect(matchPageTargetChoice("sagax_page", offers)?.tool).toBe("propose_page");
    expect(matchPageTargetChoice("Sagax artifact", offers)?.id).toBe("sagax_artifact");
    expect(matchPageTargetChoice("claude_artifact", offers)?.tool).toBe("claude_artifact");
  });
});

describe("parsePageTargetDefault", () => {
  it("accepts a target id or null to clear", () => {
    expect(parsePageTargetDefault("sagax_page")).toEqual({ ok: true, value: "sagax_page" });
    expect(parsePageTargetDefault(null)).toEqual({ ok: true, value: null });
    expect(parsePageTargetDefault("")).toEqual({ ok: true, value: null });
    expect(parsePageTargetDefault("no spaces")).toMatchObject({ ok: false });
  });
});
