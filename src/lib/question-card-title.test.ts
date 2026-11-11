import { describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { questionCardOptionLabel, questionCardSubtitle, questionCardTitle } from "./question-card-title";
import { workspaceLineText } from "./activity-runs";
import { parseWorkspaceLine } from "../../shared/workspace-line";

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

describe("the old cards and server lines in the app's language (#3515)", () => {
  it("an old card's English Yes and No read in French; a bot's own options stay", () => {
    setLocale("fr");
    const old = { title: "Your bot has a question" };
    expect([questionCardOptionLabel(old, "Yes"), questionCardOptionLabel(old, "No")]).toEqual(["Oui", "Non"]);
    expect(questionCardOptionLabel({ title: "Which region?" }, "Yes")).toBe("Yes");
    expect(questionCardOptionLabel(old, "Montreal")).toBe("Montreal");
    setLocale("en");
    expect(questionCardOptionLabel(old, "Yes")).toBe("Yes");
  });

  it("the Workspace line the server stores reads in French", () => {
    setLocale("fr");
    expect(workspaceLineText(parseWorkspaceLine("notice: Workspace: In the cloud")!)).toBe("Dans l'infonuagique");
    setLocale("en");
    expect(workspaceLineText(parseWorkspaceLine("notice: Workspace: In the cloud")!)).toBe("In the cloud");
  });
});

describe("the old brief offer card in the app's language (#3515)", () => {
  const old = {
    title: "Keep today's brief?",
    subtitle: "Today's brief was on by default, without you choosing it: I stopped it. If you say yes, I send it to you every day at 08:00, as one of my routines, which you can pause, edit or delete.",
  };

  it("its title, body and options read in French; it still answers with its stored labels", () => {
    setLocale("fr");
    expect(questionCardTitle(old)).toBe("Garder le brief du jour ?");
    expect(questionCardSubtitle(old)).toContain("Le brief du jour était actif par défaut");
    expect(questionCardSubtitle(old)).toContain("à 08:00");
    expect([questionCardOptionLabel(old, "Yes"), questionCardOptionLabel(old, "Not now")]).toEqual(["Oui", "Pas maintenant"]);
    expect(questionCardSubtitle({ title: "Keep today's brief?", subtitle: "Other words." })).toBe("Other words.");
    setLocale("en");
    expect(questionCardTitle(old)).toBe("Keep today's brief?");
  });
});

