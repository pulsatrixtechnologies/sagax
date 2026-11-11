import { describe, expect, it } from "vitest";
import en from "../../src/locales/en.json" with { type: "json" };
import fr from "../../src/locales/fr.json" with { type: "json" };
import { botTextIn, personLanguageCode, personWord, serverLineIn } from "./person-words.ts";
import { MCP_CREDENTIALS_REFUSED } from "../../shared/connector-refusal.ts";

describe("#3512: the words of a server-posted card come from the locale catalogs", () => {
  it("reads the person's language, French unless it names English", () => {
    expect(personLanguageCode("fr-CA")).toBe("fr");
    expect(personLanguageCode("en-US")).toBe("en");
    expect(personLanguageCode("")).toBe("fr");
    expect(personLanguageCode(undefined)).toBe("fr");
  });

  it("fills placeholders and falls back to English, then to the key", () => {
    expect(personWord("fr", "proactive.briefOffer.body", { time: "8 h 00" })).toBe((fr as Record<string, string>)["proactive.briefOffer.body"]!.replace("{time}", "8 h 00"));
    expect(personWord("en", "proactive.briefOffer.title")).toBe((en as Record<string, string>)["proactive.briefOffer.title"]);
    expect(personWord("fr", "no.such.key")).toBe("no.such.key");
  });

  it("the brief offer's words are in both catalogs, with no dash", () => {
    for (const key of ["proactive.briefOffer.title", "proactive.briefOffer.body", "proactive.briefOffer.yes", "proactive.briefOffer.notNow"]) {
      for (const catalog of [en, fr] as Array<Record<string, string>>) {
        expect(catalog[key], key).toBeTruthy();
        expect(catalog[key]).not.toMatch(/[–—]/);
      }
    }
  });
});

describe("#3515: a line the server stored, in the reader's language", () => {
  it("recognises each stored line back into its key", () => {
    expect(serverLineIn("fr-CA", "notice: Workspace: In the cloud")).toBe("Dans l'infonuagique");
    expect(serverLineIn("fr", "Asked by Beta")).toBe("Beta a demandé");
    expect(serverLineIn("fr", "Resuming after a restart")).toBe((fr as Record<string, string>)["step.resuming"]);
    expect(serverLineIn("fr", "the bot's own words")).toBe("the bot's own words");
  });

  it("an English reader reads English, the connector's refusal shortened with its step", () => {
    expect(serverLineIn("en", "notice: Workspace: In the cloud")).toBe("notice: Workspace: In the cloud");
    const refusal = serverLineIn("en", `MCP error -32603: ${MCP_CREDENTIALS_REFUSED}`);
    expect(refusal).toBe(`MCP error -32603: ${(en as Record<string, string>)["chat.connectorCredentialsRefused"]}`);
    expect(refusal.length).toBeLessThan(MCP_CREDENTIALS_REFUSED.length);
  });

  it("the new lines are in both catalogs, with no dash", () => {
    const keys = Object.keys(en).filter((key) => key.startsWith("routineRun.text.") || key.startsWith("proactive.nothingYet.") || key === "chat.connectorCredentialsRefused");
    expect(keys.length).toBe(25);
    for (const key of keys) {
      for (const catalog of [en, fr] as Array<Record<string, string>>) {
        expect(catalog[key], key).toBeTruthy();
        expect(catalog[key]).not.toMatch(/[–—]/);
      }
    }
  });
});

describe("#3515: a failed or partial run, said for a text-only reader", () => {
  it("says the state and the bot's reason in the reader's language", () => {
    expect(botTextIn("fr-CA", "Je n'ai pas pu entrer.", { state: "failed", reason: "the login was refused" }))
      .toBe("Je n'ai pas pu entrer.\n\nNon terminée : the login was refused");
    expect(botTextIn("en", "", { state: "partial" })).toBe("Partly done: The bot reported that only part of the work was done.");
    expect(botTextIn("fr", "Rien de spécial.", undefined)).toBe("Rien de spécial.");
  });
});
