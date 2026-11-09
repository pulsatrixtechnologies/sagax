import { describe, expect, it } from "vitest";

import { personAttention, personAttentionText, withoutBareNeedsInput } from "./person-attention.ts";

// The shape of the 2026-11-05 dispatch report (names and clients neutral).
const DISPATCH_REPORT = [
  "- [HUMAIN] **100201** (board 1, Acme) : security notice forwarded by a teammate. It stays New, held \"To sort\":",
  "  someone must decide which client it belongs to.",
  "- [HUMAIN] **100202** (board 1, Globex) : third advertising reminder. The close was refused without a reason,",
  "  so it must be set to Completed by hand.",
  "",
  "No ConnectWise writes. Board 24 had no New ticket. `verify` found nothing and the run is closed (`run.finish` ok).",
  "",
  "Other points:",
  "- I did not snapshot the routine.",
].join("\n");

describe("personAttention", () => {
  it("reads [HUMAIN] items with their tickets and continuation lines", () => {
    const found = personAttention(DISPATCH_REPORT);
    expect(found?.kind).toBe("human");
    expect(found?.items.map((item) => item.ticketId)).toEqual([100201, 100202]);
    expect(found?.items[0]!.text).toContain("someone must decide which client");
    expect(found?.items[1]!.text).toContain("Completed by hand");
    // the other bullets are not items
    expect(found?.items).toHaveLength(2);
  });

  it("reads the other tags and a needs_human array in a JSON block", () => {
    expect(personAttention("1. [NEEDS_HUMAN] #12345: approve the quote")?.items[0]).toMatchObject({ ticketId: 12345, text: "#12345: approve the quote" });
    expect(personAttention("**[HUMAN]** call the client back")?.items[0]?.text).toBe("call the client back");
    const json = "Pass done.\n```json\n{\"summary\":{\"needs_human\":[{\"ticket\":4242,\"reason\":\"assign a company\"},\"check the backup\"]}}\n```";
    const found = personAttention(json);
    expect(found?.items).toEqual([{ text: "#4242: assign a company", ticketId: 4242 }, { text: "check the backup" }]);
  });

  it("reads a question marker and a declared failure, in that order after items", () => {
    expect(personAttention("Looked at it.\nNEEDS INPUT: which board should Nova use?")).toEqual({ kind: "question", items: [{ text: "which board should Nova use?" }] });
    expect(personAttention("RUN_STATUS: partial: the CRM refused the login\nRest done.")).toEqual({ kind: "failure", items: [{ text: "the CRM refused the login" }] });
    expect(personAttention("[HUMAIN] do this\nNEEDS INPUT: and that?")?.kind).toBe("human");
  });

  it("never guesses from ordinary words", () => {
    expect(personAttention("The human resources ticket 100201 is closed. Do you need anything?")).toBeUndefined();
    expect(personAttention("Atlas mentioned [HUMAIN] in passing inside a sentence.")).toBeUndefined();
    expect(personAttention("")).toBeUndefined();
  });

  it("says it in one plain fallback line per item", () => {
    expect(personAttentionText({ kind: "human", botName: "Atlas", items: [{ text: "**100201** decide" }] })).toBe("Atlas needs you:\n- **100201** decide");
  });
});

describe("withoutBareNeedsInput (#3007)", () => {
  it("drops a line that is only the marker", () => {
    expect(withoutBareNeedsInput("NEEDS INPUT")).toBe("");
    expect(withoutBareNeedsInput("**NEEDS INPUT:**")).toBe("");
    expect(withoutBareNeedsInput("J'attends ta réponse.\nNEEDS INPUT")).toBe("J'attends ta réponse.");
  });

  it("keeps a marker that carries its question, and any other text", () => {
    expect(withoutBareNeedsInput("NEEDS INPUT: Quel billet ?")).toBe("NEEDS INPUT: Quel billet ?");
    expect(withoutBareNeedsInput("Bonjour")).toBe("Bonjour");
  });
});
