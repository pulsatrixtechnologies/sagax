import { describe, expect, it } from "vitest";
import { configuredKeyterms, looksSecret, properNouns, VOICE_KEYTERM_CHARS, VOICE_KEYTERM_MAX, voiceKeyterms } from "./voice-keyterms.js";

describe("properNouns", () => {
  it("keeps names, mixed case words and acronyms, not sentence starts", () => {
    const found = properNouns("Bonjour. Le billet de Marie Tremblay est dans ServiceNow. Peux-tu vérifier AcmeGuard pour ACME? The agent on macOS is fine.");
    expect([...found.keys()]).toEqual(expect.arrayContaining(["Marie Tremblay", "ServiceNow", "AcmeGuard", "ACME", "macOS"]));
    expect(found.has("Bonjour")).toBe(false);
    expect(found.has("Le")).toBe(false);
    expect(found.has("The")).toBe(false);
  });

  it("drops a leading common word of a capitalized run", () => {
    expect([...properNouns("please ask The Hub about it").keys()]).toContain("Hub");
  });

  it("never returns URLs, paths, e-mails or ids", () => {
    const found = [...properNouns("See https://Example.com/Path, C:\\Users\\Bob, Bob@Corp.ca and Task_ID=ABC").keys()];
    expect(found.some((term) => /[/\\@_=]/.test(term))).toBe(false);
  });

  it("never returns a token that looks like a secret, from a thread or the organization's list", () => {
    const text = "La clé AKIAIOSFODNN7EXAMPLE est dans le coffre. Le mot de passe Summer2024 marche. Token sk-proj-Ab12Cd34Ef56 et xai-Q7w9Er2T, puis ghp-16C7e42F292c6912E7710c838347Ae178B4a et K9mP2xQ7vR4tZ8wY. Le serveur SRV-01 sous Windows11 avec Office365 et GPT4 chez AcmeGuard.";
    const found = [...properNouns(text).keys()];
    for (const secret of ["AKIAIOSFODNN7EXAMPLE", "Summer2024", "sk-proj-Ab12Cd34Ef56", "xai-Q7w9Er2T", "K9mP2xQ7vR4tZ8wY"]) {
      expect(found.some((term) => term.includes(secret))).toBe(false);
    }
    expect(found.some((term) => /ghp/i.test(term))).toBe(false);
    expect(found).toEqual(expect.arrayContaining(["SRV-01", "Windows11", "Office365", "GPT4", "AcmeGuard"]));
    const terms = voiceKeyterms({ botName: "Quasar", configured: ["AKIAIOSFODNN7EXAMPLE", "CONTOSO"] });
    expect(terms).toContain("CONTOSO");
    expect(terms).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("tells a secret from a product name", () => {
    for (const secret of ["AKIAIOSFODNN7EXAMPLE", "Summer2024", "Hiver2025", "a1B2c3", "sk-abc", "xai-abcdef", "eyJhbGciOiJIUzI1NiJ9", "Zq8Lr2Vx9Pt4"]) expect(looksSecret(secret)).toBe(true);
    for (const name of ["Microsoft", "365", "SRV-01", "Windows11", "Office365", "GPT4", "iPhone", "Win10", "M365", "AcmeGuard", "X360Recover", "Skyline", "Pierre"]) expect(looksSecret(name)).toBe(false);
  });

  it("keeps product names with numbers", () => {
    expect([...properNouns("on a migré vers Microsoft 365 hier").keys()]).toContain("Microsoft 365");
  });
});

describe("voiceKeyterms", () => {
  it("puts the bot, the person and their first name first", () => {
    const terms = voiceKeyterms({ botName: "Quasar", personName: "Marie-Ève Gagnon" });
    expect(terms.slice(0, 3)).toEqual(["Quasar", "Marie-Ève Gagnon", "Marie-Ève"]);
    expect(terms).toEqual(expect.arrayContaining(["Sagax", "Perspicax", "Pulsatrix"]));
  });

  it("deduplicates across case and accents", () => {
    const terms = voiceKeyterms({ botName: "Émile", otherBotNames: ["emile", "Ellie"], configured: ["ELLIE", "Northwind"] });
    expect(terms.filter((term) => term.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "") === "emile")).toHaveLength(1);
    expect(terms.filter((term) => term.toLowerCase() === "ellie")).toHaveLength(1);
    expect(terms).toContain("Northwind");
  });

  it("ranks recent thread names by frequency and recency", () => {
    const terms = voiceKeyterms({
      botName: "Quasar",
      recentTexts: ["Old note about Zebulon.", "Le client Northwind appelle.", "Encore Northwind et Contoso.", "Contoso, Contoso."],
    });
    const thread = terms.slice(terms.indexOf("Pulsatrix") + 1);
    expect(thread.indexOf("Contoso")).toBeLessThan(thread.indexOf("Zebulon"));
    expect(thread.indexOf("Northwind")).toBeLessThan(thread.indexOf("Zebulon"));
  });

  it("respects xAI's limits", () => {
    const many = Array.from({ length: 300 }, (_, i) => `Client${i} ${"X".repeat(80)}`);
    const terms = voiceKeyterms({ botName: "B".repeat(120), configured: many, recentTexts: many });
    expect(terms.length).toBeLessThanOrEqual(VOICE_KEYTERM_MAX);
    expect(terms.every((term) => term.length <= VOICE_KEYTERM_CHARS && term.length >= 2)).toBe(true);
  });
});

describe("configuredKeyterms", () => {
  it("splits on commas and newlines", () => {
    expect(configuredKeyterms(" ServiceNow, AcmeGuard\nVeeam ,, ")).toEqual(["ServiceNow", "AcmeGuard", "Veeam"]);
    expect(configuredKeyterms(undefined)).toEqual([]);
  });
});
