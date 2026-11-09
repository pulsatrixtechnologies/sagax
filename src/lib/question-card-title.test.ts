import { describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { questionCardTitle } from "./question-card-title";

describe("questionCardTitle (#3224)", () => {
  it("reads a stored generic English title in the app's language", () => {
    setLocale("fr");
    expect(questionCardTitle({ title: "Your bot has a question", requestType: "question" })).not.toBe("Your bot has a question");
    setLocale("en");
  });
  it("keeps any other title as the bot wrote it", () => {
    setLocale("fr");
    expect(questionCardTitle({ title: "Which region?" })).toBe("Which region?");
    expect(questionCardTitle(undefined)).toBe("");
    setLocale("en");
  });
});
