import { describe, expect, it } from "vitest";
import { finalConfirmation, finalConfirmationOptions } from "./final-confirmation.ts";

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
