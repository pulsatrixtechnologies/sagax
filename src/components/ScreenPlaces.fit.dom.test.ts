// @vitest-environment happy-dom
// The VM's screen in the screen side panel fits the panel (M-20261127-181):
// the dark frame is exactly the picture, as wide or as tall as the room
// allows at the screen's own proportions, fitted again on every resize of the
// panel or the window, and it fills the room while the desktop starts.
// Fixtures only: the VNC view and the Local VM's picture are stand-ins.
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const vnc = vi.hoisted(() => ({ state: "connected", width: 1280, height: 800 }));
vi.mock("./SandboxDesktopView", () => ({
  SandboxDesktopView: () => createElement("div", { "data-sandbox-desktop": vnc.state, className: "absolute inset-0" },
    createElement("canvas", { width: vnc.width, height: vnc.height })),
}));
const local = vi.hoisted(() => ({ width: 1600, height: 900 }));
vi.mock("./computer/LocalLiveScreen", () => ({
  LocalLiveScreen: () => createElement("img", {
    "data-local-live-frame": "", alt: "", src: "data:image/png;base64,AAAA",
    ref: (image: HTMLImageElement | null) => {
      if (!image) return;
      Object.defineProperty(image, "complete", { configurable: true, value: true });
      Object.defineProperty(image, "naturalWidth", { configurable: true, get: () => local.width });
      Object.defineProperty(image, "naturalHeight", { configurable: true, get: () => local.height });
    },
  }),
}));
vi.mock("./remote-session/RemoteScreenCard", () => ({ RemoteLiveScreen: () => null, remoteControllable: () => true }));
vi.mock("./remote-session/use-remote-sessions", () => ({ useRemoteSessions: () => ({ rows: [] }) }));
vi.mock("@/lib/remote-session-focus", () => ({ useFocusedRemoteSession: () => null }));
vi.mock("@/lib/desktop-bridge", () => ({ useDesktopBridgeStatus: () => null }));
import { VmPane } from "./ScreenPlaces";

/** The room the panel leaves under its top row, as the layout would give it. */
let room = { width: 480, height: 820 };
const observers: Array<() => void> = [];
class StandInResizeObserver {
  constructor(private readonly changed: () => void) { observers.push(() => this.changed()); }
  observe() {}
  disconnect() {}
}

let host: HTMLDivElement;
let root: Root;
const frame = () => host.querySelector<HTMLElement>("[data-screen-pane=vm]")!;
const size = () => ({ width: frame().style.width, height: frame().style.height, fit: frame().dataset.screenFit });
const resizePanel = (next: { width: number; height: number }) => act(() => { room = next; for (const changed of observers) changed(); });
const render = (source: "server" | "local") => act(() => root.render(createElement(VmPane, { source, control: false, host: createRef<HTMLElement>() })));

beforeEach(() => {
  room = { width: 480, height: 820 };
  observers.length = 0;
  vnc.state = "connected";
  local.width = 1600; local.height = 900;
  vi.stubGlobal("ResizeObserver", StandInResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const box = this.hasAttribute("data-screen-room") ? room : { width: 0, height: 0 };
    return { x: 0, y: 0, left: 0, top: 0, right: box.width, bottom: box.height, ...box, toJSON: () => box } as DOMRect;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("the VM's screen in the side panel", () => {
  it("is exactly the desktop, as wide as a tall panel, at its own proportions", () => {
    render("server");
    expect(size()).toEqual({ width: "480px", height: "300px", fit: "fitted" });
    // at the top of the column, no band above it
    expect(host.querySelector("[data-screen-room]")!.className).toContain("items-start");
  });

  it.each([
    ["the narrowest panel", { width: 360, height: 760 }, { width: "360px", height: "225px" }],
    ["a wide panel", { width: 900, height: 820 }, { width: "900px", height: "562px" }],
    ["a wide short window", { width: 960, height: 420 }, { width: "672px", height: "420px" }],
  ])("follows the panel when it is resized: %s", (_case, next, fitted) => {
    render("server");
    resizePanel(next);
    expect(size()).toEqual({ ...fitted, fit: "fitted" });
  });

  it("fills the room while the desktop starts, then fits once the view connects", async () => {
    vnc.state = "connecting";
    render("server");
    expect(size()).toEqual({ width: "", height: "", fit: "filling" });
    vnc.state = "connected";
    await act(async () => { root.render(createElement(VmPane, { source: "server", control: true, host: createRef<HTMLElement>() })); await Promise.resolve(); });
    expect(size()).toEqual({ width: "480px", height: "300px", fit: "fitted" });
  });

  it("fits the Local VM's picture the same way, and refits when its picture changes shape", async () => {
    render("local");
    expect(size()).toEqual({ width: "480px", height: "270px", fit: "fitted" });
    resizePanel({ width: 720, height: 300 });
    expect(size()).toEqual({ width: "533px", height: "300px", fit: "fitted" });
    local.width = 1280; local.height = 1024;
    await act(async () => { host.querySelector("img")!.dispatchEvent(new Event("load")); });
    expect(size()).toEqual({ width: "375px", height: "300px", fit: "fitted" });
  });
});
