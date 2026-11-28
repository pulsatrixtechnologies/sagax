// @vitest-environment happy-dom
// #5414: a material body at rest is a painted still image; the engine canvas
// mounts only while the mascot is live or moving (D-20261127-038).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MaterialStillRequest } from "./shape-material-still";
import { LIVE_MIN } from "./ShapeMascot";

const asked: MaterialStillRequest[] = [];

vi.mock("./shape-material", async (importOriginal) => {
  const original = await importOriginal<typeof import("./shape-material")>();
  return {
    ...original,
    useShapeMaterial: (name: string) => (name === "flat" ? null : { id: name, render: () => null }),
    ShapeCanvas: (props: { material: { id: string }; live: boolean }) =>
      createElement("span", { "data-shape-canvas": props.material.id, "data-shape-canvas-live": props.live ? "" : undefined }),
  };
});

vi.mock("./shape-material-still", async (importOriginal) => {
  const original = await importOriginal<typeof import("./shape-material-still")>();
  return {
    ...original,
    materialStill: (request: MaterialStillRequest) => {
      asked.push(request);
      return Promise.resolve({ href: `data:image/png;base64,${request.color.slice(1)}`, x: -4, y: -4, size: 108 });
    },
  };
});

const { ShapeMascot } = await import("./ShapeMascot");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  asked.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a material mascot at rest vs live (#5414)", () => {
  it("at rest paints a still image and never mounts a canvas", async () => {
    await act(async () => {
      root.render(createElement(ShapeMascot, {
        shape: "circle",
        color: "blue",
        size: 28,
        animated: false,
        engineLook: { material: "fluffy" },
        label: null,
      }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector("[data-shape-canvas]")).toBeNull();
    const still = host.querySelector<HTMLElement>("[data-shape-material-still]");
    expect(still).not.toBeNull();
    expect(still!.getAttribute("data-shape-material-still")).toBe("fluffy");
    const img = still!.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toMatch(/^data:image\/png;base64,[0-9a-f]{6}$/);
    expect(asked[0]).toMatchObject({ material: { id: "fluffy" }, state: "idle" });
    expect(asked[0]!.color).toBe(`#${img!.getAttribute("src")!.slice("data:image/png;base64,".length)}`);
  });

  it("while live mounts the engine canvas and not the still image", async () => {
    await act(async () => {
      root.render(createElement(ShapeMascot, {
        shape: "circle",
        color: "blue",
        size: LIVE_MIN,
        animated: true,
        engineLook: { material: "glass" },
        label: null,
      }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector("[data-shape-material-still]")).toBeNull();
    const canvas = host.querySelector<HTMLElement>("[data-shape-canvas]");
    expect(canvas).not.toBeNull();
    expect(canvas!.getAttribute("data-shape-canvas")).toBe("glass");
    expect(canvas!.hasAttribute("data-shape-canvas-live")).toBe(true);
    expect(asked).toHaveLength(0);
  });
});
