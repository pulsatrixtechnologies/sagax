// @vitest-environment happy-dom
// Marks on the screen panel (#4452): draw over the live frame, Send puts one
// message (the picture, the element under each mark, the note) in the bot's
// conversation, as a steer of the turn in progress when the bot works.
import { act, createElement, createRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const upload = vi.hoisted(() => vi.fn(async () => ({ kind: "image", id: "i1", path: "/data/marked.png", name: "marked-screen.png", size: 10, mime: "image/png" })));
vi.mock("@/lib/composer-attachments", async (original) => ({ ...(await original<typeof import("@/lib/composer-attachments")>()), imageAttachmentFromFile: upload }));
import { ScreenMarksBar, ScreenMarksOverlay, useScreenMarks, type ScreenMarksState } from "./ScreenMarks";

let host: HTMLDivElement;
let root: Root;
let state: ScreenMarksState;
const dispatch = vi.fn();
const describe_ = vi.fn(async () => [{ url: "https://example.com/p", role: "button", name: "Pay" }]);

function Harness({ bot, frame }: { bot: Bot; frame: RefObject<HTMLDivElement | null> }) {
  const describer = { current: describe_ };
  state = useScreenMarks({ bot, host: frame, describer, dispatch, onSent: vi.fn(), renderImage: async () => new File(["x"], "m.png", { type: "image/png" }) });
  return createElement("div", { ref: frame, style: { position: "relative" } },
    createElement("img", { "data-browser-frame": "", "data-frame-width": 1000, "data-frame-height": 500 }),
    createElement(ScreenMarksOverlay, { marks: state }), createElement(ScreenMarksBar, { marks: state }));
}

function mount(bot: Bot) {
  const frame = createRef<HTMLDivElement>();
  act(() => root.render(createElement(Harness, { bot, frame })));
  const image = host.querySelector("img")!;
  Object.defineProperty(image, "complete", { value: true });
  Object.defineProperty(image, "naturalWidth", { value: 1000 });
  Object.defineProperty(image, "naturalHeight", { value: 500 });
  image.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0, toJSON() {} });
  act(() => root.render(createElement(Harness, { bot, frame })));
}

const drag = (from: [number, number], to: [number, number]) => {
  const svg = host.querySelector("svg")!;
  svg.setPointerCapture = () => {};
  const at = (type: string, [clientX, clientY]: [number, number]) => svg.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { clientX, clientY, pointerId: 1 }));
  act(() => { at("pointerdown", from); });
  act(() => { at("pointermove", to); });
  act(() => { at("pointerup", to); });
};

beforeEach(() => {
  dispatch.mockReset(); upload.mockClear(); describe_.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("screen marks", () => {
  it("draws a mark over the frame and keeps it until undone", () => {
    mount({ id: "ada", name: "Ada", busy: true } as unknown as Bot);
    expect(host.querySelector("[data-mark-send]")).toHaveProperty("disabled", true);
    drag([40, 40], [200, 120]);
    expect(host.querySelectorAll("[data-mark]")).toHaveLength(1);
    expect(host.querySelector("[data-mark-send]")).toHaveProperty("disabled", false);
    act(() => { (host.querySelector("[data-mark-undo]") as HTMLButtonElement).click(); });
    expect(host.querySelectorAll("[data-mark]")).toHaveLength(0);
  });

  it("sends the picture, the element under the mark and the note as a steer of the turn", async () => {
    mount({ id: "ada", name: "Ada", busy: true } as unknown as Bot);
    drag([40, 40], [200, 120]);
    act(() => { state.setNote("wrong amount"); });
    await act(async () => { await state.send(); });
    // the middle of the zone (0.3, 0.4) in the page's 1000 x 500
    expect(describe_).toHaveBeenCalledWith([{ x: 300, y: 200 }]);
    expect(upload).toHaveBeenCalledOnce();
    const sent = dispatch.mock.calls[0]![0];
    expect(sent).toMatchObject({ type: "send", botId: "ada", busyMode: "steer" });
    expect(sent.text).toContain("button “Pay”");
    expect(sent.text).toContain("Note: wrong amount");
    expect(sent.text).toContain('<attached-image path="/data/marked.png"');
  });

  it("starts a turn when the bot is idle (no steer) and sends a note alone without a picture", async () => {
    mount({ id: "ada", name: "Ada" } as unknown as Bot);
    act(() => { state.setNote("check this page"); });
    await act(async () => { await state.send(); });
    const sent = dispatch.mock.calls[0]![0];
    expect(sent.busyMode).toBeUndefined();
    expect(upload).not.toHaveBeenCalled();
    expect(sent.text).toContain("Note: check this page");
  });

  it("still sends when the page cannot be asked", async () => {
    describe_.mockRejectedValueOnce(new Error("gone"));
    mount({ id: "ada", name: "Ada", busy: true } as unknown as Bot);
    drag([40, 40], [200, 120]);
    await act(async () => { await state.send(); });
    expect(dispatch).toHaveBeenCalledOnce();
  });
});

// Lot (d): the same marks and the same sender on the VM (a VNC canvas) and the
// remote computer (its picture); no page to ask, so no describe call.
describe("screen marks on the VM and the remote computer (#4452)", () => {
  const rect = { left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0, toJSON() {} };
  function Place({ kind, frame }: { kind: "vm" | "remote"; frame: RefObject<HTMLDivElement | null> }) {
    const describer = { current: null };
    state = useScreenMarks({ bot: { id: "ada", name: "Ada" } as unknown as Bot, host: frame, describer, dispatch, onSent: vi.fn(), place: kind, renderImage: async () => new File(["x"], "m.png", { type: "image/png" }) });
    const picture = kind === "vm"
      ? createElement("div", { "data-sandbox-desktop": "connected" }, createElement("canvas", { width: 1000, height: 500 }))
      : createElement("img", { "data-remote-session-shot": "" });
    return createElement("div", { ref: frame }, picture, createElement(ScreenMarksOverlay, { marks: state }));
  }
  function mountPlace(kind: "vm" | "remote") {
    const frame = createRef<HTMLDivElement>();
    act(() => root.render(createElement(Place, { kind, frame })));
    const picture = host.querySelector(kind === "vm" ? "canvas" : "img")!;
    if (kind === "remote") {
      Object.defineProperty(picture, "complete", { value: true });
      Object.defineProperty(picture, "naturalWidth", { value: 1000 });
      Object.defineProperty(picture, "naturalHeight", { value: 500 });
    }
    picture.getBoundingClientRect = () => rect;
    act(() => root.render(createElement(Place, { kind, frame })));
  }

  it.each(["vm", "remote"] as const)("marks the %s and sends one steering message with its own words", async (kind) => {
    mountPlace(kind);
    drag([40, 40], [200, 120]);
    expect(host.querySelectorAll("[data-mark]")).toHaveLength(1);
    await act(async () => { await state.send(); });
    expect(describe_).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledOnce();
    const sent = dispatch.mock.calls[0]![0];
    expect(sent).toMatchObject({ type: "send", botId: "ada" });
    expect(sent.text).toContain(kind === "vm" ? "your VM screen" : "your remote computer");
    expect(sent.text).not.toContain("browser");
  });
});
