import { describe, expect, it } from "vitest";
import { greetingLanguage, newBotGreeting } from "./new-bot-greeting.ts";

describe("a new bot's greeting (#1075)", () => {
  it("follows the first language a level names", () => {
    expect(greetingLanguage(["fr-CA", "en"])).toBe("fr");
    expect(greetingLanguage(["", "fr"])).toBe("fr");
    expect(greetingLanguage([undefined, "en-US", "fr"])).toBe("en");
    expect(greetingLanguage([])).toBe("en");
  });
  it("greets in French or English", () => {
    expect(newBotGreeting("Juno", "fr")).toBe("Bonjour, je suis Juno. Que puis-je faire pour vous ?");
    expect(newBotGreeting("Juno", "en")).toBe("Hi, I'm Juno. What would you like me to do?");
  });
});
