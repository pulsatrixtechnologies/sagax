import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { botDescriptionText, botTitleText } from "./system-bot-copy";

const feedback = {
  systemBot: "feedback" as const,
  title: "Bogues, idées, questions",
  description: "Signalez un bogue, proposez une idée ou posez une question à l'équipe Sagax. / Report a bug, suggest an idea or ask the Sagax team a question.",
};

describe("system bot copy (#3202)", () => {
  afterEach(() => setLocale("en"));

  it("reads the Feedback bot's stored French title in English when the app is English", () => {
    setLocale("en");
    expect(botTitleText(feedback)).toBe("Bugs, ideas, questions");
    expect(botDescriptionText(feedback)).toBe("Report a bug, suggest an idea or ask the Sagax team a question.");
  });

  it("keeps French when the app is French", () => {
    setLocale("fr");
    expect(botTitleText(feedback)).toBe("Bogues, idées, questions");
    expect(botDescriptionText(feedback)).toMatch(/^Signalez un bogue/);
  });

  it("never swaps a title someone wrote, nor an ordinary bot's", () => {
    setLocale("en");
    expect(botTitleText({ ...feedback, title: "Support desk" })).toBe("Support desk");
    expect(botTitleText({ title: "Bogues, idées, questions" })).toBe("Bogues, idées, questions");
  });
});
