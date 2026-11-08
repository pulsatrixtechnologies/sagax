import { describe, expect, it } from "vitest";

import { JOURNAL_SELF, filterJournal, journalCounts, ruleTestChanged, type JournalEntry } from "../../shared/action-journal";
import { setLocale, t } from "@/lib/i18n";
import { deciderLine, guardLine } from "./action-journal";

const entry = (patch: Partial<JournalEntry>): JournalEntry => ({
  key: "k", at: "2026-10-26T12:00:00.000Z", botId: "b1", botName: "Nova", threadId: "t1", tool: "Bash", outcome: "allowed", decider: "no-card", ...patch,
});

describe("the Journal's words (2026-10-26)", () => {
  it("names the rule in its own words, the level, and the person who answered", () => {
    setLocale("fr");
    expect(deciderLine(entry({ decider: "custom-rule", ruleText: "lire des fichiers dans ~/Projets" }))).toBe("Ta règle : « lire des fichiers dans ~/Projets »");
    expect(deciderLine(entry({ decider: "level", source: "owner-auto" }))).toBe("Niveau d'approbation : Approuver pour moi");
    expect(deciderLine(entry({ decider: "person", answeredBy: JOURNAL_SELF }))).toBe("Répondu par toi");
    expect(deciderLine(entry({ decider: "full-access" }))).toBe(t("approvals.journal.decider.fullAccess"));
    expect(guardLine(entry({ guard: { allow: false, reason: "not_granted", mode: "shadow" } }))).toBe(t("approvals.journal.guard.shadow"));
    expect(guardLine(entry({ guard: { allow: true, reason: "default", mode: "shadow" } }))).toBeNull();
    setLocale("en");
  });

  it("filters by outcome, bot and words, newest first, and counts", () => {
    const rows = [
      entry({ key: "a", at: "2026-10-26T10:00:00.000Z", outcome: "denied", ruleText: "supprimer" }),
      entry({ key: "b", at: "2026-10-26T11:00:00.000Z", botId: "b2", botName: "Atlas" }),
      entry({ key: "c", at: "2026-10-26T12:00:00.000Z", outcome: "failed" }),
    ];
    expect(filterJournal(rows, { outcome: "", bot: "", q: "" }).map((row) => row.key)).toEqual(["c", "b", "a"]);
    expect(filterJournal(rows, { outcome: "denied", bot: "", q: "" }).map((row) => row.key)).toEqual(["a"]);
    expect(filterJournal(rows, { outcome: "", bot: "b2", q: "" }).map((row) => row.key)).toEqual(["b"]);
    expect(filterJournal(rows, { outcome: "", bot: "", q: "SUPPRIMER" }).map((row) => row.key)).toEqual(["a"]);
    expect(journalCounts(rows)).toEqual({ allowed: 1, asked: 0, denied: 1, failed: 1, expired: 0 });
  });

  it("says which past actions a rule would change", () => {
    expect(ruleTestChanged("allowed", "denied")).toBe(true);
    expect(ruleTestChanged("denied", "denied")).toBe(false);
    expect(ruleTestChanged("asked", "allowed")).toBe(true);
    expect(ruleTestChanged("allowed", "asked")).toBe(true);
    expect(ruleTestChanged("asked", "asked")).toBe(false);
    expect(ruleTestChanged("allowed", "card-stays")).toBe(false);
  });
});
