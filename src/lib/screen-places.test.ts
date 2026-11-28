import { describe, expect, it } from "vitest";
import type { RemoteSessionView } from "../../shared/remote-session";
import type { DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { activePlace, environmentWatchable, fitScreen, frameTime, screenPlaces } from "./screen-places";

const session = (id: string, state: "connected" | "ended" = "connected") => ({ id, state }) as unknown as RemoteSessionView;
const bridge = (connected: boolean) => ({ connected }) as unknown as DesktopBridgeStatus;
const running = { configured: true, state: "running" as const };

describe("the places of the screen panel (#4452, lot d)", () => {
  it("lists only the places the bot really has", () => {
    expect(screenPlaces({ bot: { browser: true, computer: undefined }, environment: null, bridge: null, sessions: [] }).places).toEqual(["browser"]);
    expect(screenPlaces({ bot: { browser: false, computer: undefined }, environment: null, bridge: null, sessions: [] }).places).toEqual([]);
    const all = screenPlaces({ bot: { browser: true, computer: undefined }, environment: running, bridge: null, sessions: [session("a"), session("b", "ended")] });
    expect(all.places).toEqual(["browser", "vm", "remote"]);
    expect(all.vm).toBe("server");
    expect(all.remote?.id).toBe("a");
  });

  it("never opens a missing or stopped environment, and never shows an ended session", () => {
    for (const state of ["missing", "stopped", "unavailable"] as const) expect(environmentWatchable({ configured: true, state })).toBe(false);
    expect(environmentWatchable({ configured: false, state: "running" })).toBe(false);
    expect(environmentWatchable({ configured: true, state: "paused" })).toBe(true);
    expect(screenPlaces({ bot: { browser: false, computer: undefined }, environment: null, bridge: null, sessions: [session("x", "ended")] }).places).toEqual([]);
  });

  it("follows the focused remote session, else the first connected one", () => {
    const sessions = [session("a"), session("b")];
    expect(screenPlaces({ bot: { browser: false, computer: undefined }, environment: null, bridge: null, sessions, focused: "b" }).remote?.id).toBe("b");
    expect(screenPlaces({ bot: { browser: false, computer: undefined }, environment: null, bridge: null, sessions, focused: "gone" }).remote?.id).toBe("a");
  });

  it("offers the Local VM only when the bot works there and the desktop app is connected", () => {
    const base = { environment: null, sessions: [] };
    expect(screenPlaces({ ...base, bot: { browser: false, computer: "vm" }, bridge: bridge(true) }).vm).toBe("local");
    expect(screenPlaces({ ...base, bot: { browser: false, computer: "vm" }, bridge: bridge(false) }).vm).toBeNull();
    expect(screenPlaces({ ...base, bot: { browser: false, computer: "cloud" }, bridge: bridge(true) }).vm).toBeNull();
  });

  it("keeps a pick only while its place still exists", () => {
    expect(activePlace(["browser", "vm"], "vm")).toBe("vm");
    expect(activePlace(["browser"], "vm")).toBe("browser");
    expect(activePlace([], null)).toBe("browser");
  });

  it("formats the time of a last picture", () => {
    expect(frameTime(new Date(2026, 10, 19, 14, 32, 5).getTime(), "en-US")).toMatch(/2:32:05/);
  });
});

describe("the VM's screen fits the panel (M-20261127-181)", () => {
  const desktop = { width: 1280, height: 800 };
  it.each([
    ["a narrow tall panel: the whole width", { width: 360, height: 700 }, { width: 360, height: 225 }],
    ["the default panel: the whole width", { width: 480, height: 820 }, { width: 480, height: 300 }],
    ["a wide panel: the whole width", { width: 900, height: 820 }, { width: 900, height: 562 }],
    ["a wide short panel: the whole height", { width: 960, height: 420 }, { width: 672, height: 420 }],
    ["a room of the desktop's own shape: all of it", { width: 640, height: 400 }, { width: 640, height: 400 }],
  ])("%s", (_case, room, fitted) => {
    const box = fitScreen(room, desktop)!;
    expect(box).toEqual(fitted);
    expect(box.width <= room.width && box.height <= room.height).toBe(true);
    expect(box.width === Math.floor(room.width) || box.height === Math.floor(room.height)).toBe(true);
    expect(Math.abs(box.width / box.height - desktop.width / desktop.height)).toBeLessThan(0.01);
  });

  it("keeps a phone-shaped picture's proportions too", () => {
    expect(fitScreen({ width: 480, height: 820 }, { width: 390, height: 844 })).toEqual({ width: 378, height: 820 });
  });

  it("fills the room until the picture and the room are both known", () => {
    expect(fitScreen({ width: 480, height: 820 }, null)).toBeNull();
    expect(fitScreen({ width: 0, height: 0 }, desktop)).toBeNull();
    expect(fitScreen({ width: 480, height: 820 }, { width: 0, height: 0 })).toBeNull();
  });
});
