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

  it.each([
    "Le billet est introuvable.\n\nPeux-tu confirmer le bon numéro de billet ?",
    "Peux-tu confirmer le bon numéro de billet pour ce test QA ?",
    "Peux-tu confirmer le nom du contact ?",
    "Pouvez-vous confirmer la bonne date ?",
    "Peux-tu me donner le numéro du billet ?",
    "Can you confirm the right ticket number?",
    "Please confirm the customer name.",
  ])("leaves a request for a value as plain text (#3001): %s", (text) => {
    expect(finalConfirmation({ ...context, routineRun: false, mcpStarted: true, text })).toBeNull();
  });

  it.each([
    "Peux-tu confirmer l'envoi ?",
    "Peux-tu confirmer la création du billet ?",
    "Can you confirm the send?",
    "Can I send the email to the customer?",
    "Peux-tu confirmer le billet 1234 avant que je le ferme ?",
  ])("still raises a real action confirmation (#3001): %s", (text) => {
    expect(finalConfirmation({ ...context, routineRun: false, mcpStarted: true, text })).toBe(text);
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
  it("reads the alternative from the final question only (#2911)", () => {
    const quoted = "Le client demande : voulez-vous qu'on remplace le poste, ou qu'on le répare? Dois-je créer la soumission?";
    expect(alternativeChoices(quoted)).toBeNull();
    expect(choiceOptionsFor(quoted, ["Oui", "Non"])).toEqual(["Oui", "Non"]);
    expect(choiceOptionsFor("Voulez-vous qu'on remplace le poste, ou qu'on le répare? Dois-je créer la soumission?", ["Yes", "No"])).toEqual(["Yes", "No"]);
    expect(alternativeChoices("Should I close it, or wait? The report is attached.")).toBeNull();
    expect(finalAlternative({ ...context, text: quoted })).toBeNull();
  });
  it.each([
    ["Puis-je fermer le billet, ou attendre le client?", ["Fermer le billet", "Attendre le client"]],
    ["Dois-je fermer le billet, ou attendre le client?", ["Fermer le billet", "Attendre le client"]],
    ["Est-ce que je peux fermer le billet, ou attendre le client?", ["Fermer le billet", "Attendre le client"]],
    ["Can I close the ticket, or wait for the client?", ["Close the ticket", "Wait for the client"]],
    ["Could I close the ticket, or wait for the client?", ["Close the ticket", "Wait for the client"]],
    ["May I close the ticket, or wait for the client?", ["Close the ticket", "Wait for the client"]],
    ["Puis-je écrire les entrées maintenant ou attendre lundi?", ["Écrire les entrées maintenant", "Attendre lundi"]],
    ["Peux-tu fermer le billet, ou attendre le client?", ["Fermer le billet", "Attendre le client"]],
    ["Pouvez-vous fermer le billet, ou attendre le client?", ["Fermer le billet", "Attendre le client"]],
    ["Est-ce qu'on peut fermer le billet, ou attendre le client?", ["Fermer le billet", "Attendre le client"]],
    ["Tu veux que je ferme le billet, ou qu'on attende?", ["Que je ferme le billet", "Qu'on attende"]],
    ["Do we close the ticket, or wait for the client?", ["Close the ticket", "Wait for the client"]],
    ["Do I close the ticket, or wait for the client?", ["Close the ticket", "Wait for the client"]],
  ])("drops the may-I lead from the first path (#2911): %s", (question, paths) => {
    expect(alternativeChoices(question)).toEqual(paths);
    expect(choiceOptionsFor(question, ["Oui", "Non"])).toEqual(paths);
    expect(finalAlternative({ ...context, text: question })?.options).toEqual(paths);
  });
  it.each([
    " 🙂",
    " (Réponds avec le bouton.)",
    " Merci!",
    " Réponds avec le bouton. 🙂",
  ])("still offers the two paths past a trailer after the final question (#2911): %s", (trailer) => {
    const question = `Veux-tu que je refasse la collecte à neuf, ou qu'on avance directement avec ta validation ?${trailer}`;
    const paths = ["Que je refasse la collecte à neuf", "Qu'on avance directement avec ta validation"];
    expect(alternativeChoices(question)).toEqual(paths);
    expect(choiceOptionsFor(question, ["Oui", "Non"])).toEqual(paths);
    expect(finalAlternative({ ...context, text: question })?.options).toEqual(paths);
  });
  it("a statement after a quoted either/or is not a trailer (#2911)", () => {
    expect(alternativeChoices("Le client demande « on ferme, ou on attend ? ». Je prépare la soumission.")).toBeNull();
  });
  it("keeps Yes/No for a yes-or-no question", () => {
    expect(alternativeChoices("May I proceed with the batch or not?")).toBeNull();
    expect(alternativeChoices("Puis-je écrire les entrées, ou non?")).toBeNull();
  });
});
