import { describe, expect, it } from "vitest";

import { permissionQuestion, recommendedPermissionAnswer } from "./permission-question.ts";

describe("a may-I question told apart from a real decision (#1819, #1905)", () => {
  it("reads a permission or confirmation of the bot's own next step as a may-I", () => {
    const mayI = [
      { question: "May I continue with the review and hand it to the verifier?", options: ["Yes, continue", "Not now"] },
      { title: "Approval request", question: "Should I proceed with the merge plan?", options: ["Proceed", "Hold"] },
      { question: "Do you want me to contact the verifier bot now?", options: ["Yes", "No"] },
      { question: "Go ahead and send the summary to the team?", options: ["Go ahead", "Wait"] },
      { question: "Ready to start the deployment. Confirm?", options: ["Confirm", "Cancel"] },
      { question: "I need your approval to continue.", options: ["Approve", "Deny"] },
      { question: "Shall I open the pull request?", options: ["Open it", "Skip"] },
      { question: "Puis-je envoyer le rapport au vérificateur?", options: ["Oui, envoie", "Pas maintenant"] },
      { question: "Veux-tu que je continue avec la revue des deux demandes?", options: ["Oui", "Non"] },
      { title: "Demande d'approbation", question: "Est-ce que je peux procéder au déploiement?", options: ["Procéder", "Attendre"] },
      { question: "Dois-je contacter l'autre robot pour la vérification?", options: ["Oui, contacte-le", "Non, pas encore"] },
    ];
    for (const card of mayI) {
      expect(permissionQuestion(card), card.question).toBe(true);
      expect(recommendedPermissionAnswer(card), card.question).toBe(card.options[0]);
    }
  });

  it("keeps a real decision of the person", () => {
    const decisions = [
      { question: "Which client is this report for?", options: ["Northwind", "Contoso", "Fabrikam"] },
      { question: "Which engine should the new bot use?", options: ["Claude", "Grok", "Codex"] },
      { question: "What is the budget for this quarter?", options: ["5k", "10k", "Other"] },
      { question: "Quel dossier dois-je utiliser pour les livrables?", options: ["Projets", "Archives"] },
      { question: "Lequel des deux titres préfères-tu?", options: ["Titre A", "Titre B"] },
      { question: "Pick the format of the weekly summary.", options: ["Table", "Bullets", "Prose"] },
    ];
    for (const card of decisions) {
      expect(permissionQuestion(card), card.question).toBe(false);
      expect(recommendedPermissionAnswer(card), card.question).toBeNull();
    }
  });

  it("never answers for a fact only the person can supply", () => {
    const facts = [
      { question: "Please enter the API key for the connector.", options: ["Paste it", "Later"] },
      { question: "What is the password of the shared mailbox?", options: ["Type it", "Skip"] },
      { question: "Quel est le mot de passe du compte?", options: ["Saisir", "Plus tard"] },
      { question: "Which account should I sign in with?", options: ["Work", "Personal"] },
    ];
    for (const card of facts) expect(permissionQuestion(card), card.question).toBe(false);
  });

  it("a two-answer yes or no is a confirmation by its shape", () => {
    expect(permissionQuestion({ question: "Merge now?", options: ["Yes", "No"] })).toBe(true);
    expect(permissionQuestion({ question: "On envoie?", options: ["Oui", "Non"] })).toBe(true);
    // three or more open answers are a decision
    expect(permissionQuestion({ question: "Merge now?", options: ["Today", "Tomorrow", "Next week"] })).toBe(false);
  });

  it("needs two options and some text", () => {
    expect(permissionQuestion({ question: "May I continue?", options: ["Yes"] })).toBe(false);
    expect(permissionQuestion({ question: "   ", options: ["Yes", "No"] })).toBe(false);
    expect(recommendedPermissionAnswer({ question: "May I continue?", options: ["  ", "No"] })).toBeNull();
  });
});
