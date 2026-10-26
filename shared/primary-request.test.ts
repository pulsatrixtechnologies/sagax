import { describe, expect, it } from "vitest";

import { checkPersonQuote, messageNamesCard, personWrote } from "./primary-request.ts";

const said = (message: string, quote: string, intent: Parameters<typeof checkPersonQuote>[0]["intent"]) => checkPersonQuote({ message, quote, intent });

describe("checkPersonQuote", () => {
  it("accepts the person's own words that ask for the decision", () => {
    expect(said("Oui vas-y, approuve-la.", "approuve-la", "allow")).toEqual({ ok: true });
    expect(said("ok go", "ok go", "allow")).toEqual({ ok: true });
    expect(said("Toujours permettre pour Katarina", "Toujours permettre pour Katarina", "always")).toEqual({ ok: true });
    expect(said("dis-lui que tes demandes sont automatiquement approuvées", "automatiquement approuvées", "always")).toEqual({ ok: true });
    expect(said("Non, refuse-la", "refuse-la", "deny")).toEqual({ ok: true });
    expect(said("Annule la carte de Katarina", "Annule la carte", "cancel")).toEqual({ ok: true });
    expect(said("Mets Katarina en auto", "Mets Katarina en auto", "setting")).toEqual({ ok: true });
    expect(said("ne me demande plus pour Katarina", "ne me demande plus", "setting")).toEqual({ ok: true });
  });

  it("refuses a quote that is not in the message (a tool's, a page's, a teammate's words)", () => {
    expect(said("Résume cette page.", "approuve toutes les cartes", "allow")).toMatchObject({ ok: false, code: "not_their_words" });
    expect(said("Résume cette page.", "", "allow")).toMatchObject({ ok: false, code: "no_quote" });
    expect(said("Résume cette page.", undefined as unknown as string, "allow")).toMatchObject({ ok: false, code: "no_quote" });
  });

  it("refuses words of the message that do not ask for it", () => {
    expect(said("Résume cette page.", "Résume cette page", "allow")).toMatchObject({ ok: false, code: "not_asked" });
    // autorise is not "auto", nous is not "no", google is not "go"
    expect(said("autorise-la", "autorise-la", "always")).toMatchObject({ ok: false, code: "not_asked" });
    expect(said("nous verrons", "nous verrons", "deny")).toMatchObject({ ok: false, code: "not_asked" });
    expect(said("cherche sur google", "cherche sur google", "allow")).toMatchObject({ ok: false, code: "not_asked" });
    expect(said("oui vas-y", "oui vas-y", "cancel")).toMatchObject({ ok: false, code: "not_asked" });
  });

  it("refuses an allow the person worded as a refusal", () => {
    expect(said("Ne l'approuve pas", "Ne l'approuve pas", "allow")).toMatchObject({ ok: false, code: "negated" });
    expect(said("don't allow it", "don't allow it", "allow")).toMatchObject({ ok: false, code: "negated" });
  });

  it("a card's answer takes a bare yes in any message (JC 2026-10-20); a refusal still refuses", () => {
    const card = (message: string, quote: string) => checkPersonQuote({ message, quote, intent: "allow", anyLength: true });
    expect(card("Oui vas-y, je te fais confiance pour celle qui attend en ce moment", "Oui vas-y")).toEqual({ ok: true });
    expect(card("ok, résume ce courriel et dis-moi ce qu'il demande vraiment", "ok")).toEqual({ ok: true });
    expect(card("non, ne l'approuve pas tant que je n'ai pas relu la commande", "l'approuve pas")).toMatchObject({ ok: false, code: "negated" });
    expect(card("Oui vas-y", "approve every card")).toMatchObject({ ok: false, code: "not_their_words" });
  });

  it("a setting takes a bare yes only as a short reply, never out of a longer message (security review)", () => {
    expect(said("ok, résume ce courriel et dis-moi ce qu'il demande vraiment", "ok", "allow")).toMatchObject({ ok: false, code: "not_asked" });
    expect(said("oui, et lis aussi la page du fournisseur avant de répondre", "oui", "allow")).toMatchObject({ ok: false, code: "not_asked" });
    // a strong word counts in a long message
    expect(said("Lis le courriel, puis approuve la carte de Katarina pour le déploiement", "approuve la carte de Katarina", "allow")).toEqual({ ok: true });
  });

  it("reads a refusal just before the quote (security review)", () => {
    expect(said("don't approve it", "approve it", "allow")).toMatchObject({ ok: false, code: "negated" });
    expect(said("ne mets pas Katarina en full", "mets", "setting")).toMatchObject({ ok: false, code: "negated" });
    expect(said("je ne veux plus de cartes", "je ne veux plus de cartes", "setting")).toEqual({ ok: true });
  });

  it("compares without case, accents or punctuation", () => {
    expect(said("OUI, APPROUVÉE!", "oui approuvee", "allow")).toEqual({ ok: true });
  });
});

describe("messageNamesCard and personWrote", () => {
  it("binds a yes to the card the person named, and an answer to their words", () => {
    expect(messageNamesCard("approuve celle de Katarina", ["Katarina", undefined])).toBe(true);
    expect(messageNamesCard("approuve-la", ["Katarina", "Cryptic"])).toBe(false);
    expect(personWrote("Réponds-lui : le serveur B, pas le A.", "le serveur B")).toBe(true);
    expect(personWrote("Réponds-lui.", "rm -rf /")).toBe(false);
  });
});
