import { describe, expect, it } from "vitest";

import {
  bilingualPhonePrompt,
  detectPhoneLanguage,
  isPhoneFiller,
  nextPhoneLanguage,
} from "./phone-language.ts";

describe("isPhoneFiller", () => {
  it("treats empty and one-word fillers as fillers", () => {
    expect(isPhoneFiller("")).toBe(true);
    expect(isPhoneFiller("oui")).toBe(true);
    expect(isPhoneFiller("OK")).toBe(true);
    expect(isPhoneFiller("hello")).toBe(true);
    expect(isPhoneFiller("merci")).toBe(true);
  });

  it("does not treat a real sentence as a filler", () => {
    expect(isPhoneFiller("Quelle est la météo demain")).toBe(false);
    expect(isPhoneFiller("What is on my calendar")).toBe(false);
  });
});

describe("detectPhoneLanguage", () => {
  it("detects Quebec French and English", () => {
    expect(detectPhoneLanguage("Quelle est la météo aujourd'hui")).toBe("fr");
    expect(detectPhoneLanguage("What is on my calendar today")).toBe("en");
  });

  it("returns null for fillers and unknown short noise", () => {
    expect(detectPhoneLanguage("oui")).toBe(null);
    expect(detectPhoneLanguage("xyz")).toBe(null);
  });
});

describe("nextPhoneLanguage", () => {
  it("follows the last turn and ignores fillers", () => {
    expect(nextPhoneLanguage("fr", "What time is the meeting")).toBe("en");
    expect(nextPhoneLanguage("en", "oui")).toBe("en");
    expect(nextPhoneLanguage("en", "C'est pour demain")).toBe("fr");
  });
});

describe("bilingualPhonePrompt", () => {
  it("returns fr and en prompts", () => {
    const pin = bilingualPhonePrompt("pin");
    expect(pin.fr.toLowerCase()).toContain("nip");
    expect(pin.en.toLowerCase()).toContain("pin");
    const open = bilingualPhonePrompt("opening");
    expect(open.fr.length).toBeGreaterThan(3);
    expect(open.en.length).toBeGreaterThan(3);
  });
});
