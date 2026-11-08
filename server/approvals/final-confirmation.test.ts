import { describe, expect, it } from "vitest";
import { alternativeChoices, choiceOptionsFor, finalAlternative, finalConfirmation, finalConfirmationOptions } from "./final-confirmation.ts";

const context = { routineRun: true, mcpStarted: false, ok: true, stopped: false, hasCard: false };

describe("final blocking confirmations (#1984)", () => {
  it("uses the existing English and French answer labels", () => {
    expect(finalConfirmationOptions("en")).toEqual(["Yes", "No"]);
    expect(finalConfirmationOptions("fr-CA")).toEqual(["Oui", "Non"]);
  });
  it.each([
    "May I proceed with the batch?",
    "The batch is ready. Can you confirm the two writes?",
    "Please confirm before I write the entries.",
    "I am waiting for your GO before I send the batch.",
    "Puis-je procéder aux écritures?",
    "Puis-je écrire les entrées?",
    "Veux-tu que je crée les deux entrées?",
    "Confirme ton GO pour les écritures.",
    "J'attends ton GO avant de continuer.",
    "J’ai besoin de ta confirmation explicite avant de procéder.",
    "I need your explicit approval before I write the entries.",
    "Voici le lot.\n\nEst-ce que tu confirmes les écritures?",
    "May I proceed with the batch or not?",
    "Puis-je écrire les entrées, ou non?",
  ])("raises the bot's own final request: %s", (text) => {
    expect(finalConfirmation({ ...context, text })).toBe(text);
    expect(finalConfirmation({ ...context, routineRun: false, mcpStarted: true, text })).toBe(text);
  });

  it.each([
    "The batch was written successfully.",
    "What is the project number?",
    "Can you confirm which project I should update?",
    "Peux-tu confirmer qui doit recevoir le rapport?",
    "The person asked: May I proceed with the batch?",
    "> May I proceed with the batch?",
    "```text\nMay I proceed with the batch?\n```",
    '"May I proceed with the batch?"',
    "May I proceed with the batch?\n\nAlready answered: all writes completed.",
    "Veux-tu que je refasse la collecte à neuf, ou qu'on avance directement avec ta validation sur les plages de nuit ?",
    "Do you want me to collect again, or should we go ahead with the night blocks?",
    "Puis-je écrire les entrées maintenant ou attendre lundi?",
  ])("does not turn a result or quoted material into a card: %s", (text) => {
    expect(finalConfirmation({ ...context, text })).toBeNull();
  });

  it("leaves ordinary chats, failed/stopped turns and existing cards alone", () => {
    const text = "May I proceed with the batch?";
    for (const patch of [{ routineRun: false }, { ok: false }, { stopped: true }, { hasCard: true }]) {
      expect(finalConfirmation({ ...context, ...patch, text })).toBeNull();
    }
  });
});

describe("either/or questions offer their two paths (#2901)", () => {
  const exact = "Veux-tu que je refasse la collecte à neuf, ou qu'on avance directement avec ta validation ?";
  const paths = ["Que je refasse la collecte à neuf", "Qu'on avance directement avec ta validation"];

  it("splits the exact live question into its two options", () => {
    expect(alternativeChoices(exact)).toEqual(paths);
  });
  it("raises the two paths, not Yes/No, at the end of a routine or MCP turn", () => {
    const text = `Voici le lot de la semaine.\n\n${exact}`;
    expect(finalConfirmation({ ...context, text })).toBeNull();
    expect(finalAlternative({ ...context, text })).toEqual({ question: text, options: paths });
    expect(finalAlternative({ ...context, routineRun: false, mcpStarted: true, text })?.options).toEqual(paths);
    expect(finalAlternative({ ...context, routineRun: false, text })).toBeNull();
  });
  it("replaces Yes/No on an ask_choice that asks A or B", () => {
    expect(choiceOptionsFor(exact, ["Oui", "Non"])).toEqual(paths);
    expect(choiceOptionsFor(exact, ["Yes", "No"])).toEqual(paths);
    expect(choiceOptionsFor(exact, ["Refaire", "Avancer"])).toEqual(["Refaire", "Avancer"]);
    expect(choiceOptionsFor("May I proceed with the batch?", ["Yes", "No"])).toEqual(["Yes", "No"]);
  });
  it("keeps Yes/No for a yes-or-no question", () => {
    expect(alternativeChoices("May I proceed with the batch or not?")).toBeNull();
    expect(alternativeChoices("Puis-je écrire les entrées, ou non?")).toBeNull();
  });
});
