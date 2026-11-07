import { describe, expect, it } from "vitest";

import { withoutLeakedTokens } from "./leaked-tokens";

describe("withoutLeakedTokens", () => {
  it("hides a stored bot reply that is only <|eos|> and cleans a trailing one", () => {
    const rows = [
      { id: "1", role: "user", kind: "text", text: "Envoie le courriel" },
      { id: "2", role: "bot", kind: "text", text: "<|eos|>" },
      { id: "3", role: "bot", kind: "text", text: "Envoyé.<|eos|>" },
    ];
    expect(withoutLeakedTokens(rows)).toEqual([rows[0], { ...rows[2], text: "Envoyé." }]);
    expect(rows[1]!.text).toBe("<|eos|>");
  });

  it("returns the same array when nothing changes, and leaves a person's text alone", () => {
    const rows = [{ id: "1", role: "user", kind: "text", text: "<|eos|>" }, { id: "2", role: "bot", kind: "text", text: "a < b" }];
    expect(withoutLeakedTokens(rows)).toBe(rows);
  });
});
