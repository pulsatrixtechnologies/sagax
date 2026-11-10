// The capability line of a page version (src/lib/page-capabilities-line.ts).
import { describe, expect, it, vi } from "vitest";

import { capabilitiesAdded, capabilityLine, capabilityParts, versionCapabilities } from "./page-capabilities-line";

const html = (block: string) => `<!doctype html><title>x</title>${block}<p>hi</p>`;
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
  it("reads the declaration from the version's own source, once", async () => {
    const read = vi.fn(async () => ({ content: html('<script type="application/sagax-capabilities+json">{"data":["team-board"],"viewer":true}</script>') }));
    expect(await versionCapabilities("page_a", 3, "html", read)).toEqual({ data: ["team-board"], viewer: true, open: false });
    await versionCapabilities("page_a", 3, "html", read);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith("/api/pages/page_a/versions/3/source");
  });

  it("asks nothing for a page that is not HTML, and has none when the source cannot be read", async () => {
    const read = vi.fn(async () => ({ content: "# hi" }));
    expect(await versionCapabilities("page_b", 1, "markdown", read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(await versionCapabilities("page_c", 1, "html", async () => { throw new Error("offline"); })).toBeNull();
  });
});
