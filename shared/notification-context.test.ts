import { describe, expect, it } from "vitest";

import {
  asksForAlternative,
  buildNotificationContext,
  CHOICE_LABEL_MAX,
  choiceQuestionMismatch,
  choiceShortLabel,
  isYesNoChoices,
  notificationChoiceLabels,
  notificationContextText,
} from "./notification-context.ts";

describe("notification context (#2909)", () => {
  it("turns a markdown table into readable lines, one per row", () => {
    const text = notificationContextText("Deux copies diffèrent :\n\n| Copie | Date | Taille |\n|---|---|---:|\n| **Locale** | 7 nov. | 12 Ko |\n| Serveur | 8 nov. | 14 Ko |");
    expect(text).toBe("Deux copies diffèrent :\n\nCopie: Locale · Date: 7 nov. · Taille: 12 Ko\nCopie: Serveur · Date: 8 nov. · Taille: 14 Ko");
    expect(text).not.toContain("|");
    expect(text).not.toContain("**");
  });

  it("keeps headings, bullets, links and code as words", () => {
    expect(notificationContextText("## Résumé\n- [ ] voir [le billet](https://x.test/1)\n- `pnpm test`")).toBe("Résumé\n• voir le billet\n• pnpm test");
  });

  it("lays out the question, what each answer does, then the detail", () => {
    const context = buildNotificationContext({
      question: "Je relance la sauvegarde ou j'attends ?",
      detail: "La sauvegarde de 2 h a échoué deux fois (disque plein).",
      choices: [{ answer: "Relancer", detail: "Relance maintenant" }, { answer: "Attendre" }],
    });
    expect(context).toBe("Je relance la sauvegarde ou j'attends ?\n\n• Relancer: Relance maintenant\n• Attendre\n\nLa sauvegarde de 2 h a échoué deux fois (disque plein).");
  });

  it("gives buttons short labels shown whole, or none (Open only)", () => {
    expect(choiceShortLabel("Créer le billet : un billet neuf au tableau Service")).toBe("Créer le billet");
    expect(choiceShortLabel("Archiver seulement les anciens billets fermés depuis plus de 90 jours")).toBeUndefined();
    expect(notificationChoiceLabels(["Oui", "Non"])).toEqual({ labels: ["Oui", "Non"], legible: true });
    expect(notificationChoiceLabels(["A", "B", "C", "D", "E"]).legible).toBe(false);
    expect(notificationChoiceLabels(["Archiver seulement les anciens billets fermés depuis plus de 90 jours", "Rien"]).legible).toBe(false);
    for (const label of notificationChoiceLabels(["Créer : maintenant", "Archiver : plus tard"]).labels ?? []) expect(label.length).toBeLessThanOrEqual(CHOICE_LABEL_MAX);
  });

  it("never pairs Yes / No with an \"A or B?\" question", () => {
    expect(isYesNoChoices(["Oui", "Non"])).toBe(true);
    expect(asksForAlternative("Je garde la copie locale ou celle du serveur ?")).toBe(true);
    expect(asksForAlternative("Lequel je publie ?")).toBe(true);
    expect(asksForAlternative("Je publie ou non ?")).toBe(false);
    expect(asksForAlternative("Je publie la version 2.4 ?")).toBe(false);
    expect(choiceQuestionMismatch("Je garde la copie locale ou celle du serveur ?", ["Oui", "Non"])).toBeTruthy();
    expect(choiceQuestionMismatch("Je garde la copie locale ou celle du serveur ?", ["Locale", "Serveur"])).toBeUndefined();
  });

  it("keeps the question and every answer when the detail is long; only the detail is cut", () => {
    const detail = Array.from({ length: 12 }, (_, index) => `Item ${index + 1}: ${"un long résumé de routine qui explique ce qui s'est passé ".repeat(2)}`).join("\n");
    const choices = [
      { answer: "Relancer la synchronisation complète", detail: "Recopie tout depuis le serveur, environ 20 minutes" },
      { answer: "Garder la copie locale", detail: "Écrase la copie du serveur avec la locale" },
      { answer: "Attendre demain", detail: "Ne fait rien maintenant, la routine reposera la question" },
    ];
    const context = buildNotificationContext({ question: "Je relance la synchro, je garde la locale ou j'attends ?", detail, choices });
    expect(context.length).toBeLessThanOrEqual(1200);
    expect(context.startsWith("Je relance la synchro, je garde la locale ou j'attends ?\n\n• Relancer la synchronisation complète: Recopie tout")).toBe(true);
    for (const choice of choices) expect(context).toContain(`• ${choice.answer}: ${choice.detail}`);
    expect(context).toContain("Item 1:");
    // a payload cut from its end loses the detail, never an answer
    expect(context.slice(0, 400)).toContain("• Attendre demain");
  });

  it("keeps a pipe inside inline code in its cell", () => {
    expect(notificationContextText("| Commande | Effet |\n|---|---|\n| `a|b` | filtre |")).toBe("Commande: a|b · Effet: filtre");
  });

  it("does not list a single answer as a choice", () => {
    expect(buildNotificationContext({ question: "Quoi ?", choices: [{ answer: "Oui" }] })).toBe("Quoi ?");
    expect(notificationChoiceLabels(["Oui"]).legible).toBe(false);
  });

  it("allows four buttons, like the iOS banner", () => {
    expect(notificationChoiceLabels(["A", "B", "C", "D"]).legible).toBe(true);
    expect(notificationChoiceLabels(["A", "B", "C", "D", "E"]).legible).toBe(false);
  });

  it("reads yes / no variants and the alternative forms", () => {
    expect(isYesNoChoices(["Oui, la locale", "Non"])).toBe(true);
    expect(isYesNoChoices(["Oui", "Non", "Autre"])).toBe(true);
    expect(isYesNoChoices(["Locale", "Serveur"])).toBe(false);
    expect(asksForAlternative("Je publie (ou j'attends) ?")).toBe(true);
    expect(asksForAlternative("Tu veux la locale, la distante ?")).toBe(true);
    expect(asksForAlternative("Qu'est-ce que je garde ?")).toBe(true);
    expect(asksForAlternative("Où je le range ?")).toBe(true);
    expect(asksForAlternative("Is it OK to send it to Alex or Sam?")).toBe(false);
    expect(choiceQuestionMismatch("Is it OK to send it to Alex or Sam?", ["Yes", "No"])).toBeUndefined();
    expect(choiceQuestionMismatch("Je garde la locale ou la distante ?", ["Oui, la locale", "Non"])).toBeTruthy();
    expect(choiceQuestionMismatch("Je garde la locale ou la distante ?", ["Oui", "Non", "Autre"])).toBeTruthy();
  });
});
