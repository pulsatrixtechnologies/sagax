// The capability line of a page version (src/lib/page-capabilities-line.ts).
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "./i18n";
import { type PageCapabilities } from "../../shared/page-capabilities";

import { capabilitiesAdded, capabilityLine, capabilityParts, versionCapabilities } from "./page-capabilities-line";

const BOARD = { data: ["team-board" as const], viewer: false, open: false, files: [] };

describe("capabilityLine", () => {
  it("says what the page reads, in words", () => {
    expect(capabilityLine({ data: ["team-board"], viewer: true, open: true, files: [] })).toBe("Reads: the work of your coding teams, your name and role, opens links and chats");
    expect(capabilityParts(BOARD)).toEqual(["the work of your coding teams"]);
    expect(capabilityParts({ data: ["bot"], viewer: false, open: false, files: [] })).toEqual(["this page's bot"]);
    setLocale("fr");
    try {
      expect(capabilityParts({ data: ["bot"], viewer: false, open: false, files: [] })).toEqual(["le bot de cette page"]);
    } finally {
      setLocale("en");
    }
  });

  it("says nothing for a page with no declaration", () => {
    expect(capabilityLine(null)).toBeNull();
    expect(capabilityLine({ data: [], viewer: false, open: false, files: [] })).toBeNull();
  });

  it("says what a new version adds to the published one", () => {
    expect(capabilityLine({ data: ["team-board"], viewer: true, open: false, files: [] }, BOARD)).toBe("New in this version: your name and role");
    expect(capabilityLine({ data: ["team-board"], viewer: true, open: false, files: [] }, null)).toBe("New in this version: the work of your coding teams, your name and role");
    // nothing added: it still says what it reads
    expect(capabilityLine(BOARD, BOARD)).toBe("Reads: the work of your coding teams");
    expect(capabilitiesAdded(BOARD, BOARD)).toBeNull();
  });
});

describe("versionCapabilities", () => {
  it("asks the server what that version declares, once", async () => {
    const read = vi.fn(async () => ({ version: 3, capabilities: { data: ["team-board"], viewer: true, open: false } }));
    expect(await versionCapabilities("page_a", 3, read)).toEqual({ data: ["team-board"], viewer: true, open: false, files: [] });
    await versionCapabilities("page_a", 3, read);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith("/api/pages/page_a/capabilities?version=3");
  });

  it("has none when the server says none or cannot be reached", async () => {
    expect(await versionCapabilities("page_b", 1, async () => ({ capabilities: { data: [], viewer: false, open: false } }))).toEqual({ data: [], viewer: false, open: false, files: [] });
    expect(await versionCapabilities("page_c", 1, async () => { throw new Error("offline"); })).toBeNull();
  });
});

describe("a file the page hands you", () => {
  const filesOnly = { data: [], viewer: false, open: false, files: ["download"] } as PageCapabilities;
  const none = { data: [], viewer: false, open: false, files: [] };

  it("names the part, and says when a version adds it", () => {
    setLocale("en");
    try {
      expect(capabilityParts(filesOnly)).toEqual(["a file it hands you"]);
      expect(capabilityLine(filesOnly)).toBe("Reads: a file it hands you");
      expect(capabilityParts(capabilitiesAdded(filesOnly, none))).toEqual(["a file it hands you"]);
      expect(capabilityLine(filesOnly, none)).toBe("New in this version: a file it hands you");
      setLocale("fr");
      expect(capabilityParts(filesOnly)).toEqual(["un fichier que cette page te remet"]);
      expect(capabilityLine(filesOnly)).toBe("Lit : un fichier que cette page te remet");
      expect(capabilityLine(filesOnly, none)).toBe("Nouveau dans cette version : un fichier que cette page te remet");
    } finally {
      setLocale("en");
    }
  });
});

describe("what a page keeps, asks and calls (#3413 lots 3 to 7)", () => {
  const none = { data: [], viewer: false, open: false, files: [] };
  const all: PageCapabilities = {
    ...none,
    files: ["add"],
    store: { votes: { write: "signed_in", scope: "shared" }, prefs: { write: "signed_in", scope: "reader" } },
    model: true,
    propose: true,
    connectors: { GitHub: ["search_issues", "create_issue"] },
  };

  it("names every part in words, nothing invisible", () => {
    setLocale("en");
    try {
      // a page that keeps, asks or acts says what it may do, not "Reads"
      expect(capabilityLine(all)).toBe("May do: files you add, documents it keeps for everyone who reads it, documents it keeps for you alone, a question to a model, with your account, proposes new versions of itself, GitHub with your account: search_issues, create_issue");
      setLocale("fr");
      expect(capabilityParts(all)).toEqual([
        "les fichiers que tu y ajoutes",
        "des documents qu'elle garde pour qui la lit",
        "des documents qu'elle garde pour toi seulement",
        "une question à un modèle, avec ton compte",
        "propose de nouvelles versions d'elle-même",
        "GitHub avec ton compte : search_issues, create_issue",
      ]);
    } finally {
      setLocale("en");
    }
  });

  it("says what a new version adds: a collection, the model, proposals, a connector's new tool", () => {
    const before: PageCapabilities = { ...none, store: { votes: { write: "signed_in", scope: "shared" } }, connectors: { GitHub: ["search_issues"] } };
    const added = capabilitiesAdded(all, before)!;
    expect(added.store).toEqual({ prefs: { write: "signed_in", scope: "reader" } });
    expect(added.connectors).toEqual({ GitHub: ["create_issue"] });
    expect(added.model).toBe(true);
    expect(added.propose).toBe(true);
    expect(capabilitiesAdded(all, all)).toBeNull();
  });
});
