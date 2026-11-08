import { describe, expect, it } from "vitest";
import { greetingLanguage, newBotGreeting, seedGreetingPatches } from "./new-bot-greeting.ts";
import { introTaskCard } from "../intro-tour.ts";

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

describe("the first-run greeting follows the first request's language (#2803)", () => {
  const seed = (language: "fr" | "en") => [
    { id: "m1", role: "bot", kind: "text", text: newBotGreeting("Juno", language) },
    { id: "m2", role: "bot", kind: "options", card: { ...introTaskCard(language).card } },
  ];
  it("says the untouched greeting and intro card again in French", () => {
    const patches = seedGreetingPatches(seed("en"), "Juno", "fr");
    expect(patches?.greeting).toEqual({ id: "m1", text: newBotGreeting("Juno", "fr") });
    expect(patches?.card).toEqual({ id: "m2", card: introTaskCard("fr").card });
  });
  it("leaves a conversation already in that language, answered or continued", () => {
    expect(seedGreetingPatches(seed("fr"), "Juno", "fr")).toBeNull();
    const answered = seed("en");
    (answered[1]!.card as Record<string, unknown>).answer = "x";
    expect(seedGreetingPatches(answered, "Juno", "fr")).toBeNull();
    expect(seedGreetingPatches([...seed("en"), { id: "m3", role: "user", kind: "text", text: "hi" }], "Juno", "fr")).toBeNull();
    expect(seedGreetingPatches(seed("en"), "Other", "fr")).toBeNull();
  });
});
