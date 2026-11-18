import { describe, expect, it } from "vitest";

import type { DesktopBridgeStatus } from "./desktop-bridge";
import { sandboxViewerPath, sandboxViewerProblem, showsSandboxDesktop, takeoverKey } from "./sandbox-desktop";

const bridge = (connected: boolean, place: "computer" | "server"): DesktopBridgeStatus => ({
  connected, tunnel: false, desktops: [], activity: [], workplace: { place, network: "all" },
});

describe("server environment desktop in the Computer panel", () => {
  it("shows only where bots work in the server environment", () => {
    expect(showsSandboxDesktop(null)).toBe(false);
    expect(showsSandboxDesktop(bridge(true, "computer"))).toBe(false);
    expect(showsSandboxDesktop(bridge(false, "computer"))).toBe(true);
    expect(showsSandboxDesktop(bridge(true, "server"))).toBe(true);
  });

  it("asks for the caller's own desktop only, control on request", () => {
    expect(sandboxViewerPath(false)).toBe("/api/desktop-viewer/sandbox/me");
    expect(sandboxViewerPath(true, true)).toBe("/api/desktop-viewer/sandbox/me/websockify?control=1");
    expect(sandboxViewerProblem(403)).toBe("closed");
    expect(sandboxViewerProblem(429)).toBe("busy");
    expect(sandboxViewerProblem(409)).toBe("unavailable");
    expect(sandboxViewerProblem(502)).toBe("unavailable");
  });

  it("says when the environment is from before the desktop", () => {
    expect(sandboxViewerProblem(409, "outdated")).toBe("outdated");
    expect(sandboxViewerProblem(403, "outdated")).toBe("closed");
    expect(sandboxViewerProblem(409, "paused")).toBe("unavailable");
  });

  it("closes the take-control window with Cmd/Ctrl+Shift+Escape, or an Escape not meant for the screen", () => {
    const key = (extra: Partial<KeyboardEvent> = {}) => ({ key: "Escape", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...extra });
    expect(takeoverKey(key({ shiftKey: true, metaKey: true }), true)).toBe("close");
    expect(takeoverKey(key({ shiftKey: true, ctrlKey: true }), true)).toBe("close");
    // A plain Escape typed into the remote screen goes to the remote screen.
    expect(takeoverKey(key(), true)).toBeNull();
    expect(takeoverKey(key(), false)).toBe("close");
    expect(takeoverKey(key({ ctrlKey: true }), false)).toBeNull();
    expect(takeoverKey(key({ key: "a" }), false)).toBeNull();
  });
});
