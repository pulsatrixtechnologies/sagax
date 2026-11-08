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
    expect(text).toBe("Deux copies diffèrent :\n\nCopie : Locale · Date : 7 nov. · Taille : 12 Ko\nCopie : Serveur · Date : 8 nov. · Taille : 14 Ko");
    expect(text).not.toContain("|");
    expect(text).not.toContain("**");
  });

  it("keeps headings, bullets, links and code as words", () => {
    expect(notificationContextText("## Résumé\n- [ ] voir [le billet](https://x.test/1)\n- `pnpm test`")).toBe("Résumé\n• voir le billet\n• pnpm test");
  });

  it("lays out the question, the detail, then what each answer does", () => {
    const context = buildNotificationContext({
      question: "Je relance la sauvegarde ou j'attends ?",
      detail: "La sauvegarde de 2 h a échoué deux fois (disque plein).",
      choices: [{ answer: "Relancer", detail: "Relance maintenant" }, { answer: "Attendre" }],
    });
    expect(context).toBe("Je relance la sauvegarde ou j'attends ?\n\nLa sauvegarde de 2 h a échoué deux fois (disque plein).\n\n• Relancer : Relance maintenant\n• Attendre");
  });

  it("gives buttons short labels shown whole, or none (Open only)", () => {
    expect(choiceShortLabel("Créer le billet : un billet neuf au tableau Service")).toBe("Créer le billet");
    expect(choiceShortLabel("Archiver seulement les anciens billets fermés depuis plus de 90 jours")).toBeUndefined();
    expect(notificationChoiceLabels(["Oui", "Non"])).toEqual({ labels: ["Oui", "Non"], legible: true });
    expect(notificationChoiceLabels(["A", "B", "C", "D"]).legible).toBe(false);
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
});
