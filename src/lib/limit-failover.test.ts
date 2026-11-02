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

  it("names a cross-engine move when the engine had no conversation model left (#1696)", () => {
    setLocale("en");
    expect(limitFailoverLineText({ kind: "switched", from: "OpenAI", to: "Claude", resetsAt: AT, reason: "model" }, NOW))
      .toBe("OpenAI had no model left for this conversation: continuing on Claude.");
    expect(limitFailoverLineText({ kind: "switched", from: "OpenAI", to: "Auto", resetsAt: AT, reason: "model" }, NOW))
      .toBe("OpenAI had no model left for this conversation: Auto continued the same turn on another engine.");
    setLocale("fr");
    expect(limitFailoverLineText({ kind: "switched", from: "OpenAI", to: "Claude", resetsAt: AT, reason: "model" }, NOW))
      .toBe("OpenAI n'avait plus de modèle pour cette conversation : je continue sur Claude.");
  });

  // 2026-11-02: an engine that named no reset never reads as one that did:
  // the time is only when Sagax tries it again.
  it("says the engine gave no reset time when Sagax only estimated it, in English and Quebec French", () => {
    const guessed: LimitFailoverLine = { ...switched, estimated: true };
    setLocale("en");
    expect(limitFailoverLineText(guessed, NOW)).toBe("Limit reached on Claude, which gave no reset time: continuing on Codex; Claude is tried again around 2:05 PM.");
    expect(limitFailoverLineText({ ...guessed, owner: true }, NOW)).toBe("This bot's owner has reached their usage limit on Claude, which gave no reset time: continuing on Codex; Claude is tried again around 2:05 PM.");
    expect(limitFailoverLineText({ kind: "waiting", from: "Claude", resetsAt: AT, estimated: true }, NOW))
      .toBe("Limit reached on Claude, which gave no reset time, and no other engine is available: your message will be sent again around 2:05 PM.");
    expect(limitFailoverLineText({ kind: "waitingRoutine", from: "Claude", resetsAt: AT, estimated: true }, NOW))
      .toBe("Limit reached on Claude, which gave no reset time, and no other engine is available: this routine runs again around 2:05 PM.");
    setLocale("fr");
    expect(limitFailoverLineText(guessed, NOW)).toBe("Limite atteinte sur Claude, qui n'a pas donné d'heure de réinitialisation : je continue sur Codex ; Claude sera réessayé vers 14 h 05.");
    expect(limitFailoverLineText({ kind: "waiting", from: "Claude", resetsAt: AT, estimated: true, owner: true }, NOW))
      .toBe("Le propriétaire de ce bot a atteint sa limite d'utilisation sur Claude, qui n'a pas donné d'heure de réinitialisation, et aucun autre moteur n'est disponible : votre message sera renvoyé vers 14 h 05.");
    expect(limitFailoverLineText({ kind: "waitingRoutine", from: "Claude", resetsAt: AT, estimated: true }, NOW))
      .toBe("Limite atteinte sur Claude, qui n'a pas donné d'heure de réinitialisation, et aucun autre moteur n'est disponible : cette routine sera relancée vers 14 h 05.");
    // The English words other clients show say the same.
    const clock = (at: number) => resetClockText(at, "en-US", undefined, NOW);
    expect(limitFailoverText(guessed, clock)).toBe("Limit reached on Claude, which gave no reset time: continuing on Codex; Claude is tried again around 2:05 PM.");
    expect(limitFailoverText({ kind: "waiting", from: "Claude", resetsAt: AT, estimated: true }, clock)).not.toMatch(/when it resets/);
  });

  // 2026-11-02: a quick model Sagax picked for the turn (a call's, a wake's)
  // is not the conversation's: the line never says it goes back to it.
  it("says Sagax skips a refused quick model it picked, never that the conversation goes back to it", () => {
    const detour: LimitFailoverLine = { kind: "switched", from: "Codex (gpt-6.1-luna)", to: "Grok", resetsAt: AT, detour: true };
    setLocale("en");
    expect(limitFailoverLineText(detour, NOW)).toBe("Limit reached on Codex (gpt-6.1-luna), a quick model Sagax picked for this turn: continuing on another model. Sagax skips Codex (gpt-6.1-luna) for quick turns until it resets (around 2:05 PM).");
    expect(limitFailoverLineText({ ...detour, estimated: true }, NOW)).toBe("Limit reached on Codex (gpt-6.1-luna), a quick model Sagax picked for this turn: continuing on another model. Codex (gpt-6.1-luna) gave no reset time: Sagax skips it for quick turns until around 2:05 PM.");
    setLocale("fr");
    expect(limitFailoverLineText(detour, NOW)).toBe("Limite atteinte sur Codex (gpt-6.1-luna), un modèle rapide choisi par Sagax pour ce tour : je continue sur un autre modèle. Sagax évite Codex (gpt-6.1-luna) pour les tours rapides jusqu'à sa réinitialisation (vers 14 h 05).");
    expect(limitFailoverLineText({ ...detour, estimated: true }, NOW)).toBe("Limite atteinte sur Codex (gpt-6.1-luna), un modèle rapide choisi par Sagax pour ce tour : je continue sur un autre modèle. Codex (gpt-6.1-luna) n'a pas donné d'heure de réinitialisation : Sagax l'évite pour les tours rapides jusque vers 14 h 05.");
    // The English words other clients show say the same.
    const clock = (at: number) => resetClockText(at, "en-US", undefined, NOW);
    expect(limitFailoverText(detour, clock)).toBe("Limit reached on Codex (gpt-6.1-luna), a quick model Sagax picked for this turn: continuing on another model. Sagax skips Codex (gpt-6.1-luna) for quick turns until it resets (around 2:05 PM).");
    expect(limitFailoverText(detour, clock)).not.toMatch(/continuing on Grok|back on/i);
  });

  // 2026-11-02 (review): a backup standing in for the conversation's own engine is refused in turn. The line names
  // both, and the return is to the conversation's own engine at its own reset, never to the backup that refused.
  it("names the engine a refused backup stood in for, and the return to it, in English and Quebec French", () => {
    const standIn: LimitFailoverLine = { kind: "switched", from: "Codex", to: "Grok", resetsAt: AT, home: "Claude" };
    const back: LimitFailoverLine = { kind: "back", engine: "Claude", refused: "Codex" };
    setLocale("en");
    expect(limitFailoverLineText(standIn, NOW)).toBe("Limit reached on Codex, which was standing in for Claude: continuing on Grok, back on Claude when it resets (around 2:05 PM).");
    expect(limitFailoverLineText({ ...standIn, estimated: true }, NOW)).toBe("Limit reached on Codex, which was standing in for Claude: continuing on Grok. Claude gave no reset time: it is tried again around 2:05 PM.");
    expect(limitFailoverLineText(back, NOW)).toBe("Limit reached on Codex, which was standing in for Claude: back on Claude, whose limit has reset.");
    setLocale("fr");
    expect(limitFailoverLineText(standIn, NOW)).toBe("Limite atteinte sur Codex, qui remplaçait Claude : je continue sur Grok, puis retour sur Claude à sa réinitialisation (vers 14 h 05).");
    expect(limitFailoverLineText({ ...standIn, estimated: true }, NOW)).toBe("Limite atteinte sur Codex, qui remplaçait Claude : je continue sur Grok. Claude n'a pas donné d'heure de réinitialisation : il sera réessayé vers 14 h 05.");
    expect(limitFailoverLineText(back, NOW)).toBe("Limite atteinte sur Codex, qui remplaçait Claude : retour sur Claude, dont la limite est réinitialisée.");
    // The English words other clients show say the same.
    const clock = (at: number) => resetClockText(at, "en-US", undefined, NOW);
    expect(limitFailoverText(standIn, clock)).toBe("Limit reached on Codex, which was standing in for Claude: continuing on Grok, back on Claude when it resets (around 2:05 PM).");
    expect(limitFailoverText({ ...standIn, estimated: true }, clock)).toBe("Limit reached on Codex, which was standing in for Claude: continuing on Grok. Claude gave no reset time: it is tried again around 2:05 PM.");
    expect(limitFailoverText(back, clock)).toBe("Limit reached on Codex, which was standing in for Claude: back on Claude, whose limit has reset.");
    expect(limitFailoverText(standIn, clock)).not.toMatch(/back on Codex|until it resets/);
  });

  it("is a recovery status row the transcript never folds, whatever its English words", () => {
    setLocale("fr");
    const message = { id: "x", at: NOW, role: "bot", kind: "activity",
      tool: { name: `recovery: ${limitFailoverText(switched, (at) => resetClockText(at, "en-US"))}`, ok: true, limitFailover: switched } } as Message;
    expect(statusActivity(message)).toEqual({ kind: "recovery", text: expect.stringContaining("je continue sur Codex") });
  });
});
