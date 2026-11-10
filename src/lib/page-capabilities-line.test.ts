// The capability line of a page version (src/lib/page-capabilities-line.ts).
import { describe, expect, it, vi } from "vitest";

import { capabilitiesAdded, capabilityLine, capabilityParts, versionCapabilities } from "./page-capabilities-line";

const BOARD = { data: ["team-board" as const], viewer: false, open: false };

describe("capabilityLine", () => {
  it("says what the page reads, in words", () => {
    expect(capabilityLine({ data: ["team-board"], viewer: true, open: true })).toBe("Reads: the work of your coding teams, your name and role, opens links and chats");
    expect(capabilityParts(BOARD)).toEqual(["the work of your coding teams"]);
  });

  it("says nothing for a page with no declaration", () => {
    expect(capabilityLine(null)).toBeNull();
    expect(capabilityLine({ data: [], viewer: false, open: false })).toBeNull();
  });

  it("says what a new version adds to the published one", () => {
    expect(capabilityLine({ data: ["team-board"], viewer: true, open: false }, BOARD)).toBe("New in this version: your name and role");
    expect(capabilityLine({ data: ["team-board"], viewer: true, open: false }, null)).toBe("New in this version: the work of your coding teams, your name and role");
    // nothing added: it still says what it reads
    expect(capabilityLine(BOARD, BOARD)).toBe("Reads: the work of your coding teams");
    expect(capabilitiesAdded(BOARD, BOARD)).toBeNull();
  });
});

describe("versionCapabilities", () => {
  it("asks the server what that version declares, once", async () => {
    const read = vi.fn(async () => ({ version: 3, capabilities: { data: ["team-board"], viewer: true, open: false } }));
    expect(await versionCapabilities("page_a", 3, read)).toEqual({ data: ["team-board"], viewer: true, open: false });
    await versionCapabilities("page_a", 3, read);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith("/api/pages/page_a/capabilities?version=3");
  });

  it("has none when the server says none or cannot be reached", async () => {
    expect(await versionCapabilities("page_b", 1, async () => ({ capabilities: { data: [], viewer: false, open: false } }))).toEqual({ data: [], viewer: false, open: false });
    expect(await versionCapabilities("page_c", 1, async () => { throw new Error("offline"); })).toBeNull();
  });
});
