import { afterEach, describe, expect, it } from "vitest";

import { statusActivity } from "@/lib/activity-runs";
import { setLocale } from "@/lib/i18n";
import { limitFailoverLineText } from "@/lib/limit-failover";
import type { Message } from "@/state/store";
import { limitFailoverText, resetClockText, type LimitFailoverLine } from "../../shared/limit-failover";

const NOW = new Date(2026, 9, 19, 12, 0).getTime();
const AT = new Date(2026, 9, 19, 14, 5).getTime();
const switched: LimitFailoverLine = { kind: "switched", from: "Claude", to: "Codex", resetsAt: AT };

describe("the usage-limit line", () => {
  afterEach(() => { setLocale("en"); });

  it("reads in Quebec French, the reset in the reader's clock", () => {
    setLocale("fr");
    expect(limitFailoverLineText(switched, NOW)).toBe("Limite atteinte sur Claude : je continue sur Codex jusqu'à la réinitialisation (vers 14 h 05).");
    expect(limitFailoverLineText({ kind: "back", engine: "Claude" }, NOW)).toBe("La limite de Claude est réinitialisée : retour sur Claude.");
    expect(limitFailoverLineText({ kind: "waiting", from: "Claude", resetsAt: AT }, NOW)).toContain("votre message sera renvoyé à la réinitialisation (vers 14 h 05)");
    expect(limitFailoverLineText({ kind: "waitingRoutine", from: "Claude", resetsAt: AT }, NOW)).toContain("cette routine sera relancée");
  });

  it("reads in English, with the weekday when the reset is not today", () => {
    setLocale("en");
    expect(limitFailoverLineText(switched, NOW)).toBe("Limit reached on Claude: continuing on Codex until it resets (around 2:05 PM).");
    const tomorrow = new Date(2026, 9, 20, 9, 30).getTime();
    expect(limitFailoverLineText({ ...switched, resetsAt: tomorrow }, NOW)).toMatch(/around Tue 9:30 AM/);
  });

  it("is a recovery status row the transcript never folds, whatever its English words", () => {
    setLocale("fr");
    const message = { id: "x", at: NOW, role: "bot", kind: "activity",
      tool: { name: `recovery: ${limitFailoverText(switched, (at) => resetClockText(at, "en-US"))}`, ok: true, limitFailover: switched } } as Message;
    expect(statusActivity(message)).toEqual({ kind: "recovery", text: expect.stringContaining("je continue sur Codex") });
  });
});
