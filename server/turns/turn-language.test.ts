import { describe, expect, it } from "vitest";

import { looksFrench, textLanguage } from "../../shared/looks-french.ts";
import { lastPersonText, turnLanguage } from "./turn-language.ts";

describe("turn language (#2762)", () => {
  it("follows the words of the last message, then the setting", () => {
    expect(turnLanguage("Please summarize what you found in the logs", "fr")).toBe("en");
    expect(turnLanguage("Résume ce que tu as trouvé dans les journaux", "en")).toBe("fr");
    expect(turnLanguage("ok", "fr-CA")).toBe("fr");
    expect(turnLanguage("ok", "en-US")).toBe("en");
    expect(turnLanguage(undefined, undefined)).toBe("en");
  });

  it("reads the last text message of the person", () => {
    expect(lastPersonText([
      { role: "user", kind: "text", text: "premier" },
      { role: "bot", kind: "text", text: "réponse" },
      { role: "user", kind: "text", text: "second" },
      { role: "user", kind: "activity", text: "x" },
    ])).toBe("second");
  });

  it("keeps looksFrench as it was (short or neutral text counts as French)", () => {
    expect(textLanguage("ok")).toBeNull();
    expect(looksFrench("ok")).toBe(true);
    expect(looksFrench("1234 5678 9012 3456")).toBe(true);
    expect(looksFrench("Can you please check this for me")).toBe(false);
  });
});
