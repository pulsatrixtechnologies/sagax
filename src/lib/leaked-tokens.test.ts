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

  it("hides a completed routine run whose report was only <|eos|> and keeps one that says more", () => {
    const run = (extra: { summary?: string; problems?: string }) => ({ runId: "r", routineId: "x", routineName: "New Outlook email", status: "completed", ...extra });
    const rows = [
      { id: "1", role: "bot", kind: "routine.run", text: "<|eos|>", routineRun: run({ summary: "<|eos|>" }) },
      { id: "2", role: "bot", kind: "routine.run", text: "Trois courriels.<|eos|>", routineRun: run({ summary: "Trois courriels.<|eos|>" }) },
      { id: "3", role: "bot", kind: "routine.run", text: "x", routineRun: run({ summary: "<|eos|>", problems: "Outlook refused" }) },
      { id: "4", role: "bot", kind: "routine.run", text: "ok", routineRun: run({ summary: "Rien de neuf" }) },
    ];
    const shown = withoutLeakedTokens(rows);
    expect(shown.map((m) => m.id)).toEqual(["2", "3", "4"]);
    expect(shown[0]!.routineRun!.summary).toBe("Trois courriels.");
    expect(shown[0]!.text).toBe("Trois courriels.");
    expect(shown[1]!.routineRun!.summary).toBeUndefined();
    expect(shown[2]).toBe(rows[3]);
    expect(rows[0]!.routineRun.summary).toBe("<|eos|>");
  });
});
