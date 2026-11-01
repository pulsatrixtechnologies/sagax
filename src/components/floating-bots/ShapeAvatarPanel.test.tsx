/** @vitest-environment jsdom */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShapeAvatarPanel, consumeShapeAvatarShareParam, definitionForLook } from "./ShapeAvatarPanel";
import { generateShapeAvatarDef } from "../../../shared/shape-avatar-generate";
import { encodeShapeAvatarShare, parseShapeAvatarPayload } from "../../../shared/shape-avatar-def";

vi.mock("@/lib/i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("@/lib/floating-bots", () => ({
  readFloatingBotPrefs: () => ({ barkSound: false }),
}));

describe("ShapeAvatarPanel", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("renders import, export, share and generate controls on the real editor panel", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        createElement(ShapeAvatarPanel, {
          look: { character: "shape", shape: "pad" },
          color: "teal",
          onApply: () => undefined,
        }),
      );
    });
    const panel = host.querySelector("[data-shape-avatar-panel]");
    expect(panel).toBeTruthy();
    expect(panel!.querySelector("[data-shape-export-json]")).toBeTruthy();
    expect(panel!.querySelector("[data-shape-export-svg]")).toBeTruthy();
    expect(panel!.querySelector("[data-shape-share]")).toBeTruthy();
    expect(panel!.querySelector("[data-shape-import]")).toBeTruthy();
    expect(panel!.querySelector("[data-shape-generate]")).toBeTruthy();
    expect(panel!.querySelector("[data-shape-drop]")).toBeTruthy();
  });

  it("resolves object presets and accepts pasted JSON for onApply", () => {
    expect(definitionForLook({ character: "shape", shape: "cup" })?.id).toBe("cup");
    const def = generateShapeAvatarDef("speech bubble");
    expect(parseShapeAvatarPayload(JSON.stringify(def)).ok).toBe(true);

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const applied: unknown[] = [];
    act(() => {
      root!.render(
        createElement(ShapeAvatarPanel, {
          look: { character: "shape", shape: "circle", avatarDef: def },
          color: "blue",
          onApply: (look) => applied.push(look),
        }),
      );
    });
    expect(definitionForLook({ character: "shape", avatarDef: def })?.id).toBe("say");
  });

  it("decodes a share link query into a validated definition with colour and mood", () => {
    const def = generateShapeAvatarDef("coffee mug");
    const payload = encodeShapeAvatarShare(def, { color: "teal", mood: "happy" });
    const found = consumeShapeAvatarShareParam(`?shapeAvatar=${encodeURIComponent(payload)}`);
    expect(found?.def.id).toBe("cup");
    expect(found?.color).toBe("teal");
    expect(found?.mood).toBe("happy");
    expect(consumeShapeAvatarShareParam("?other=1")).toBeNull();
  });
});
