import { describe, expect, it } from "vitest";
import { askedForView } from "./requested-views.ts";

describe("askedForView", () => {
  it("is false for an ordinary request (the 2026-10-20 prod case)", () => {
    for (const text of ["can you list me the ticket I have for today in connectwise?", "liste mes billets d'aujourd'hui", "combien d'heures cette semaine ?", "regarde le billet 123", "call the Microsoft Graph API", "mets-le en tableau", "", undefined]) {
      expect(askedForView(text, "view")).toBe(false);
      expect(askedForView(text, "video")).toBe(false);
      expect(askedForView(text, "screen")).toBe(false);
    }
  });

  it("is true when the person names the view", () => {
    expect(askedForView("montre-moi mes billets en tableau interactif", "view")).toBe(true);
    expect(askedForView("fais-moi un graphique des heures", "view")).toBe(true);
    expect(askedForView("show my schedule as an interactive table", "view")).toBe(true);
    expect(askedForView("make me a chart", "view")).toBe(true);
    expect(askedForView("joue la vidéo", "video")).toBe(true);
    expect(askedForView("play the stream", "video")).toBe(true);
    expect(askedForView("fais une capture d'écran", "screen")).toBe(true);
    expect(askedForView("montre-moi l'écran", "screen")).toBe(true);
    expect(askedForView("take a screenshot", "screen")).toBe(true);
    expect(askedForView("make a diagram of the flow", "view")).toBe(true);
    expect(askedForView("une visualisation des billets", "view")).toBe(true);
    expect(askedForView("affiche-les sous forme de carte", "view")).toBe(true);
    expect(askedForView("fais-moi une calculatrice", "view")).toBe(true);
    expect(askedForView("fais une capture de l’écran", "screen")).toBe(true);
    expect(askedForView("prends une capture", "screen")).toBe(true);
    expect(askedForView("what does the screen show?", "screen")).toBe(true);
  });
});
