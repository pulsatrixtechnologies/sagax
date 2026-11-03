import { describe, expect, it } from "vitest";
import { cwActionLanguage } from "./cw-widget-actions.ts";
import { personLanguage, personLanguageOf } from "./person-language.ts";
import { serverApprovalWords } from "./approvals/approval-words.ts";
import { emailSendSummary } from "../shared/email-draft-send.ts";

describe("the person's language, not the server's", () => {
  it("prefers the person's choice over the server default", () => {
    expect(personLanguage("en", "fr")).toBe("en");
    expect(personLanguage("fr-CA", "en")).toBe("fr-CA");
  });

  it("falls back to the server default when the person has not chosen", () => {
    expect(personLanguage(undefined, "fr")).toBe("fr");
    expect(personLanguage("", "fr")).toBe("fr");
    expect(personLanguage(3, undefined)).toBe("");
  });

  it("words an email send and a ConnectWise action for an English person on a French server", () => {
    const language = personLanguage("en", "fr");
    expect(cwActionLanguage(language)).toBe("en");
    const draft = { to: ["a@b.c"], cc: [], bcc: [], subject: "Hi", body: "x" } as never;
    expect(emailSendSummary(draft, { kind: "smtp", label: "the server's mail" } as never, language)).toMatch(/^Send the email/);
  });
});

describe("personLanguageOf (push and rule text)", () => {
  const prefs = (map: Record<string, string>) => (id: string) => (id in map ? { "omb-language": map[id] } : undefined);
  it("uses the person's own language for the card words, not the server's", () => {
    const words = (person: string, server: string) => serverApprovalWords(personLanguageOf(person, prefs({ ana: "fr", ben: "en" }), server), {});
    expect(words("ana", "en").locale).toBe("fr");
    expect(words("ben", "fr").locale).toBe("en");
    expect(words("zed", "fr").locale).toBe("fr");
  });
  it("falls back to the server default when the store throws or nobody is named", () => {
    expect(personLanguageOf("ana", () => { throw new Error("no store"); }, "fr")).toBe("fr");
    expect(personLanguageOf(undefined, prefs({}), "en")).toBe("en");
    expect(personLanguageOf("", prefs({ "": "fr" }), "en")).toBe("en");
  });
});

describe("a routine run's thread title date", () => {
  it("follows the person's language", async () => {
    const { runTitleDate } = await import("./routines/routines.ts");
    const at = Date.UTC(2026, 9, 26, 15, 30);
    expect(runTitleDate(at, "en")).toMatch(/Oct/);
    expect(runTitleDate(at, "fr")).toMatch(/oct\./);
    expect(runTitleDate(at, "")).toMatch(/Oct/);
    expect(runTitleDate(at, "not a tag!")).toMatch(/Oct/);
  });
});
