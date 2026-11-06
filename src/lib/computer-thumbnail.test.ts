import { describe, expect, it } from "vitest";

import type { DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { computerThumbnailUrl, sameHost, thumbnailComputerFor, thumbnailDesktop } from "./computer-thumbnail";

const bridge = (desktops: Array<{ id: string; name: string; online: boolean; lastSeenAt: number }>) =>
  ({ connected: true, tunnel: false, desktops, workplace: {}, activity: [] }) as unknown as DesktopBridgeStatus;

describe("computer thumbnail", () => {
  it("picks the selected computer's picture", () => {
    expect(thumbnailComputerFor(undefined, null)).toBe("auto");
    expect(thumbnailComputerFor("cloud", null)).toBe("cloud");
    expect(thumbnailComputerFor("vm", null)).toBe("vm");
    expect(thumbnailComputerFor("local", null)).toBe("local");
    expect(thumbnailComputerFor("off", null)).toBeNull();
    expect(thumbnailComputerFor("browser", null)).toBeNull();
  });

  it("names the person's own desktop on an organization server only", () => {
    const status = bridge([
      { id: "old", name: "Old PC", online: false, lastSeenAt: 1 },
      { id: "mac-1", name: "Mac.local", online: true, lastSeenAt: 2 },
    ]);
    expect(thumbnailComputerFor("local", status, true)).toBe("local:mac-1");
    expect(thumbnailComputerFor("local", status, false)).toBe("local");
    expect(thumbnailDesktop(status)).toMatchObject({ desktop: { id: "mac-1" }, online: true });
    expect(thumbnailDesktop(bridge([{ id: "old", name: "Old", online: false, lastSeenAt: 1 }]))).toMatchObject({ online: false });
  });

  it("versions the URL by capture time", () => {
    expect(computerThumbnailUrl("b1", "local:mac-1", 42)).toBe("/api/bots/b1/computer/thumbnail?computer=local%3Amac-1&v=42");
    expect(computerThumbnailUrl("b1", "vm", 42, "full")).toBe("/api/bots/b1/computer/thumbnail?computer=vm&v=42&size=full");
  });

  it("compares host names the way macOS shows them", () => {
    expect(sameHost("Jean-Christophes-Macbook-Pro.local", "jean-christophes-macbook-pro")).toBe(true);
    expect(sameHost("Mac", "Other")).toBe(false);
    expect(sameHost("", "")).toBe(false);
  });
});
