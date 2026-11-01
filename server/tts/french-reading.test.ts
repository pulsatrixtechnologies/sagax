import { describe, expect, it } from "vitest";

import { looksFrench, readFrench, readsFrench, readsFrenchText } from "./french-reading.ts";

describe("French reading for the voice", () => {
  it("leaves words that are already speakable", () => {
    expect(readFrench("Bonjour")).toBe("Bonjour");
    expect(readFrench("Bonjour Ada.")).toBe("Bonjour Ada.");
  });

  it("reads a time, a price, an ordinal and a title", () => {
    expect(readFrench("Rendez-vous à 14 h 30.")).toBe("Rendez-vous à 14 heures 30.");
    expect(readFrench("Rendez-vous à 14h30.")).toBe("Rendez-vous à 14 heures 30.");
    expect(readFrench("À 1 h 30.")).toBe("À 1 heure 30.");
    expect(readFrench("C'est 25 $.")).toBe("C'est 25 dollars.");
    expect(readFrench("C'est $ 25.")).toBe("C'est 25 dollars.");
    expect(readFrench("C'est 1 $.")).toBe("C'est 1 dollar.");
    expect(readFrench("C'est 25 €.")).toBe("C'est 25 euros.");
    expect(readFrench("Le 1er mai, la 1re fois, le 2e et le 10e.")).toBe(
      "Le premier mai, la première fois, le deuxième et le dixième.",
    );
    expect(readFrench("M. Martin, Mme Curie, Mlle Dupont et Dr Pasteur habitent St-Laurent, rue Ste-Catherine.")).toBe(
      "Monsieur Martin, Madame Curie, Mademoiselle Dupont et Docteur Pasteur habitent Saint-Laurent, rue Sainte-Catherine.",
    );
  });

  it("reads a clock time, an ISO date, a percentage and a decimal the Québec way", () => {
    expect(readFrench("Le billet est fermé à 15:30.")).toBe("Le billet est fermé à 15 heures 30.");
    expect(readFrench("Rendez-vous à 09:00, puis 14 h 00 et 0:05.")).toBe("Rendez-vous à 9 heures, puis 14 heures et minuit 5.");
    expect(readFrench("Fini à 17:45:12.")).toBe("Fini à 17 heures 45.");
    expect(readFrench("Sauvegarde du 2026-10-18.")).toBe("Sauvegarde du 18 octobre 2026.");
    expect(readFrench("Prochaine le 2026-11-01T08:15:00Z.")).toBe("Prochaine le premier novembre 2026 à 8 heures 15 UTC.");
    expect(readFrench("Le disque est plein à 85 %, soit 3.5 To.")).toBe("Le disque est plein à 85 pour cent, soit 3,5 To.");
    expect(readFrench("Version 1.8.35, adresse 10.0.0.1, format 16:9.")).toBe("Version 1.8.35, adresse 10.0.0.1, format 16:9.");
    expect(readFrench("Python 3.12, iOS 18.2, Sagax 0.5, la v1.2 et la version 2.1.")).toBe("Python 3.12, iOS 18.2, Sagax 0.5, la v1.2 et la version 2.1.");
  });

  it("never reads a duration, a score or a verse as a time of day", () => {
    expect(readFrench("Durée 00:02:13.")).toBe("Durée 00:02:13.");
    expect(readFrench("Le temps : 01:30, en 03:12.")).toBe("Le temps : 01:30, en 03:12.");
    expect(readFrench("Jean 3:16 et le score 2:10.")).toBe("Jean 3:16 et le score 2:10.");
    expect(readFrench("Rendez-vous à 3:30, vers 9:15.")).toBe("Rendez-vous à 3 heures 30, vers 9 heures 15.");
    expect(readFrench("Il est 3:30 PM.")).toBe("Il est 3:30 PM.");
    expect(readFrench("En panne depuis 15:30.")).toBe("En panne depuis 15 heures 30.");
    expect(readFrench("Pas une date 2026-13-45 ni 25:99.")).toBe("Pas une date 2026-13-45 ni 25:99.");
  });

  it("applies only to a French language", () => {
    expect(readsFrench("fr")).toBe(true);
    expect(readsFrench("fr-CA")).toBe(true);
    expect(readsFrench("en")).toBe(false);
    expect(readsFrench("auto")).toBe(false);
  });

  it("an automatic call reads French when the text looks French, never English", () => {
    expect(looksFrench("Votre rendez-vous est à 14h30.")).toBe(true);
    expect(looksFrench("C'est 25 $ pour le 1er mois.")).toBe(true);
    expect(looksFrench("Le billet est fermé demain")).toBe(true);
    expect(looksFrench("Dr Smith will see you at 2pm, it is 25 $.")).toBe(false);
    // Short texts count as French (shared/looks-french.ts): they never break a French thread.
    expect(looksFrench("OK")).toBe(true);
    expect(readsFrenchText("auto", "Votre rendez-vous est à 14h30.")).toBe(true);
    expect(readsFrenchText("auto", "Dr Smith will see you.")).toBe(false);
    expect(readsFrenchText("en", "Votre rendez-vous est à 14h30.")).toBe(false);
    expect(readsFrenchText("fr-CA", "OK")).toBe(true);
  });
});
