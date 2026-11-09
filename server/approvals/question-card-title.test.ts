import { describe, expect, it } from "vitest";
import { questionCardTitle } from "./approval-words.ts";

// #3080: the ask_choice card title follows the person's language.
describe("questionCardTitle", () => {
  it("is French for a French person, English otherwise", () => {
    expect(questionCardTitle("fr-CA", {})).toBe("Ton bot a une question");
    expect(questionCardTitle("fr", {})).toBe("Ton bot a une question");
    expect(questionCardTitle("en-US", {})).toBe("Your bot has a question");
    expect(questionCardTitle(undefined, {})).toBe("Your bot has a question");
  });
});
