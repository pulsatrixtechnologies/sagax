import { describe, expect, it } from "vitest";
import { stripRequesterAddress } from "./relay-reply";

describe("stripRequesterAddress (#2808)", () => {
  const body = "Voici trois idées de nom :\n\n1. L'Essentiel\n2. Le Fil\n3. En Bref";

  it("drops the closing line addressed to the requesting bot", () => {
    expect(stripRequesterAddress(`${body}\n\n@Gaston, voilà les trois propositions avec leur justification pour l'utilisateur.`, "Gaston"))
      .toBe(body);
  });

  it("drops an opening line addressed to it, on its own line", () => {
    expect(stripRequesterAddress(`@gaston voici ce que tu m'as demandé :\n${body}`, "Gaston")).toBe(body);
  });

  it("keeps a mention inside the answer and other names", () => {
    const text = `${body}\n\nMerci @Gaston de m'avoir sollicitée.`;
    expect(stripRequesterAddress(text, "Gaston")).toBe(text);
    expect(stripRequesterAddress(`${body}\n\n@Gastonia est un autre bot.`, "Gaston")).toBe(`${body}\n\n@Gastonia est un autre bot.`);
  });

  it("keeps a reply that is only the address", () => {
    expect(stripRequesterAddress("@Gaston, c'est fait.", "Gaston")).toBe("@Gaston, c'est fait.");
  });
});
