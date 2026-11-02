// The words a run says when a limit refused its turn (server/routines/routine-limit-words.ts),
// in English and Quebec French. They are the run's status line, its notification
// and the Team incidents report a Primary Bot relays: they name the engine that
// refused, say where the run went on, give the real reset, and never claim a run
// is down while another engine runs it.
import { describe, expect, it } from "vitest";

import {
  limitWhen, routineLimitCreditsText, routineLimitStoppedText, routineLimitSwitchedText, routineLimitUnknownEngineText,
  routineLimitWaitingText, type RoutineUsageLimit,
} from "./routine-limit-words.ts";

const NOW = Date.UTC(2026, 10, 2, 13, 16);
const HOUR = 3_600_000;
const UTC = { timeZone: "UTC" };
const FR = { language: "fr-CA", timeZone: "UTC" };
const codex: RoutineUsageLimit = { kind: "quota", from: "Codex (gpt-6.1-luna)", resetsAt: NOW + 2 * HOUR, estimated: false };

/** Every sentence a person or a bot reads: no em or en dash, no "stays down", no guessed "this bot's engine". */
function plain(text: string): void {
  expect(text).not.toMatch(/[\u2013\u2014]/);
  expect(text).not.toMatch(/stays down|this bot's engine|reste en panne/i);
}

describe("a run another engine took over", () => {
  // The conversation's own engine refused (no detour): the line names the engine alone, and the run goes back to it.
  it("says which engine refused, where the run goes on, and when the first one is back", () => {
    const text = routineLimitSwitchedText({ ...codex, from: "Codex", to: "Grok" }, UTC);
    expect(text).toBe("Usage limit reached on Codex: this run continues on Grok. Back on Codex once it resets, around Nov 2, 3:16 PM (UTC).");
    plain(text);
  });

  it("says the same in Quebec French, the date and the time joined by \"à\"", () => {
    const text = routineLimitSwitchedText({ ...codex, from: "Codex", to: "Grok" }, FR);
    expect(text).toBe("Limite d'utilisation atteinte sur Codex : cette exécution continue sur Grok. Retour sur Codex à sa réinitialisation, vers le 2 nov. à 15 h 16 (UTC).");
    plain(text);
  });

  it("calls a rate limit a rate limit, and an estimated reset an estimate", () => {
    const rate: RoutineUsageLimit = { kind: "rate_limited", from: "Claude", resetsAt: NOW + 15 * 60_000, estimated: true };
    const en = routineLimitSwitchedText({ ...rate, to: "Codex" }, UTC);
    expect(en).toBe("Rate limit reached on Claude: this run continues on Codex. Claude gave no reset time: it is tried again around Nov 2, 1:31 PM (UTC).");
    expect(en).not.toMatch(/usage limit/i);
    const fr = routineLimitSwitchedText({ ...rate, to: "Codex" }, FR);
    expect(fr).toBe("Limite de débit atteinte sur Claude : cette exécution continue sur Codex. Claude n'a pas donné d'heure de réinitialisation : il sera réessayé vers le 2 nov. à 13 h 31 (UTC).");
    plain(en);
    plain(fr);
  });

  it("names Auto's next pick when the bot is on Auto", () => {
    expect(routineLimitSwitchedText({ ...codex, from: "Claude", to: "Auto" }, UTC))
      .toBe("Usage limit reached on Claude: Auto continues it on another model. Back on Claude once it resets, around Nov 2, 3:16 PM (UTC).");
    expect(routineLimitSwitchedText({ ...codex, from: "Claude", to: "Auto" }, FR))
      .toBe("Limite d'utilisation atteinte sur Claude : Auto poursuit cette exécution sur un autre modèle. Retour sur Claude à sa réinitialisation, vers le 2 nov. à 15 h 16 (UTC).");
  });

  // 2026-11-02 (review): the engine that refused was itself standing in for the bot's own engine. The run never goes
  // back to that backup: the return named is the bot's own engine, at its own reset.
  it("names the bot's own engine for the return when the refused engine was standing in for it", () => {
    const chain: RoutineUsageLimit = { ...codex, from: "Codex", home: { name: "Claude", resetsAt: NOW + 3 * HOUR, estimated: false } };
    const en = routineLimitSwitchedText({ ...chain, to: "Grok" }, UTC);
    expect(en).toBe("Usage limit reached on Codex: this run continues on Grok. Back on Claude once it resets, around Nov 2, 4:16 PM (UTC).");
    expect(en).not.toMatch(/back on codex/i);
    const fr = routineLimitSwitchedText({ ...chain, to: "Grok" }, FR);
    expect(fr).toBe("Limite d'utilisation atteinte sur Codex : cette exécution continue sur Grok. Retour sur Claude à sa réinitialisation, vers le 2 nov. à 16 h 16 (UTC).");
    // Back on the bot's own engine, free again.
    const back = { ...chain, home: { name: "Claude", resetsAt: NOW - HOUR, estimated: false }, to: "Claude", backHome: true as const };
    expect(routineLimitSwitchedText(back, UTC)).toBe("Usage limit reached on Codex: this run goes back to Claude, whose limit has reset.");
    expect(routineLimitSwitchedText(back, FR)).toBe("Limite d'utilisation atteinte sur Codex : cette exécution revient sur Claude, dont la limite s'est réinitialisée.");
    plain(en);
    plain(fr);
  });
});

// 2026-11-02: a quick model Sagax picked for the run (a proactive wake's fast model) is not the bot's engine: the run
// never goes back to it, Sagax only skips it for quick turns until it resets, and no line tells the person to change
// the bot's engine over it.
describe("a run whose quick model, picked by Sagax, a limit refused", () => {
  const detour: RoutineUsageLimit = { ...codex, detour: true };

  it("says Sagax skips that model until it resets, never that the run goes back to it", () => {
    const en = routineLimitSwitchedText({ ...detour, to: "Grok" }, UTC);
    expect(en).toBe("Usage limit reached on Codex (gpt-6.1-luna): this run continues on Grok. Sagax skips Codex (gpt-6.1-luna) for quick turns until it resets, around Nov 2, 3:16 PM (UTC).");
    expect(en).not.toMatch(/back on/i);
    const fr = routineLimitSwitchedText({ ...detour, to: "Grok" }, FR);
    expect(fr).toBe("Limite d'utilisation atteinte sur Codex (gpt-6.1-luna) : cette exécution continue sur Grok. Sagax évite Codex (gpt-6.1-luna) pour les tours rapides jusqu'à sa réinitialisation, vers le 2 nov. à 15 h 16 (UTC).");
    expect(fr).not.toMatch(/retour sur/i);
    plain(en);
    plain(fr);
  });

  it("names Sagax's estimate as one when the engine gave no reset time", () => {
    const guessed = { ...detour, resetsAt: NOW + HOUR, estimated: true };
    expect(routineLimitSwitchedText({ ...guessed, to: "Grok" }, UTC))
      .toBe("Usage limit reached on Codex (gpt-6.1-luna): this run continues on Grok. Codex (gpt-6.1-luna) gave no reset time: Sagax skips it for quick turns until around Nov 2, 2:16 PM (UTC).");
    expect(routineLimitSwitchedText({ ...guessed, to: "Grok" }, FR))
      .toBe("Limite d'utilisation atteinte sur Codex (gpt-6.1-luna) : cette exécution continue sur Grok. Codex (gpt-6.1-luna) n'a pas donné d'heure de réinitialisation : Sagax l'évite pour les tours rapides jusque vers le 2 nov. à 14 h 16 (UTC).");
  });

  it("never advises choosing another engine for the bot when nothing could take the run", () => {
    const en = routineLimitStoppedText({ ...detour, noTaker: "none" }, UTC);
    expect(en).toBe("Usage limit reached on Codex (gpt-6.1-luna). No other engine can take over. Sagax skips Codex (gpt-6.1-luna) for quick turns until it resets, around Nov 2, 3:16 PM (UTC).");
    const fr = routineLimitStoppedText({ ...detour, noTaker: "none" }, FR);
    expect(fr).toBe("Limite d'utilisation atteinte sur Codex (gpt-6.1-luna). Aucun autre moteur ne peut prendre le relais. Sagax évite Codex (gpt-6.1-luna) pour les tours rapides jusqu'à sa réinitialisation, vers le 2 nov. à 15 h 16 (UTC).");
    // Not even with automatic switching off: that quick model is not the bot's engine.
    expect(routineLimitStoppedText({ ...detour, noTaker: "off" }, UTC)).not.toMatch(/choose another engine/i);
    expect(en).not.toMatch(/choose another engine/i);
    expect(fr).not.toMatch(/autre moteur pour ce bot/i);
    plain(en);
    plain(fr);
  });

  it("words a quick model out of credit the same way, with no advice to change the bot's engine", () => {
    const credit = { ...detour, resetsAt: NOW + HOUR, estimated: true, noTaker: "off" as const };
    const en = routineLimitCreditsText(credit, UTC);
    expect(en).toBe("Codex (gpt-6.1-luna), a quick model Sagax picked for this run, is out of credit: Sagax skips it for quick turns until around Nov 2, 2:16 PM (UTC). Automatic switching to another engine is off on this server.");
    const fr = routineLimitCreditsText(credit, FR);
    expect(fr).toBe("Codex (gpt-6.1-luna), un modèle rapide choisi par Sagax pour cette exécution, n'a plus de crédit : Sagax l'évite pour les tours rapides jusque vers le 2 nov. à 14 h 16 (UTC). Le passage automatique à un autre moteur est désactivé sur ce serveur.");
    expect(en).not.toMatch(/choose another engine|this bot/i);
    expect(fr).not.toMatch(/pour ce bot/i);
    plain(en);
    plain(fr);
  });
});

describe("a run no other engine could take", () => {
  it("waits for the reset and says when this run starts again", () => {
    const at = NOW + 2 * HOUR + 60_000;
    const en = routineLimitWaitingText({ kind: "quota", from: "Claude", noTaker: "none" }, at, UTC);
    expect(en).toBe("Usage limit reached on Claude. No other engine can take over. This run starts again at the reset, Nov 2, 3:17 PM (UTC).");
    const fr = routineLimitWaitingText({ kind: "quota", from: "Claude", noTaker: "none" }, at, FR);
    expect(fr).toBe("Limite d'utilisation atteinte sur Claude. Aucun autre moteur ne peut prendre le relais. Cette exécution repart à la réinitialisation, le 2 nov. à 15 h 17 (UTC).");
    plain(en);
    plain(fr);
  });

  // 2026-11-02 (review): a second engine's limit refused the run after it took it over. The run waits for the
  // earliest reset, the bot's own engine's when it comes first, and the words name that engine.
  it("names the bot's own engine when the run waits for it, and the backup when it resets first", () => {
    const chain = { kind: "quota" as const, from: "Codex", home: { name: "Claude", resetsAt: NOW + 2 * HOUR, estimated: false }, noTaker: "none" as const };
    const at = NOW + 2 * HOUR + 60_000;
    expect(routineLimitWaitingText(chain, at, UTC, "Claude"))
      .toBe("Usage limit reached on Codex, which was standing in for Claude. No other engine can take over. This run starts again on Claude at its reset, Nov 2, 3:17 PM (UTC).");
    expect(routineLimitWaitingText(chain, at, FR, "Claude"))
      .toBe("Limite d'utilisation atteinte sur Codex, qui remplaçait Claude. Aucun autre moteur ne peut prendre le relais. Cette exécution repart sur Claude à la réinitialisation de sa limite, le 2 nov. à 15 h 17 (UTC).");
    expect(routineLimitWaitingText(chain, at, UTC, "Codex"))
      .toBe("Usage limit reached on Codex, which was standing in for Claude. No other engine can take over. This run starts again on Codex at its reset, Nov 2, 3:17 PM (UTC).");
    plain(routineLimitWaitingText(chain, at, FR, "Codex"));
  });

  it("says why nothing took the run over: the most moves Sagax makes, or switching off on this server", () => {
    const at = NOW + 2 * HOUR + 60_000;
    const cap = { kind: "quota" as const, from: "Grok", home: { name: "Claude", resetsAt: NOW + 2 * HOUR, estimated: false }, noTaker: "cap" as const };
    expect(routineLimitWaitingText(cap, at, UTC, "Claude"))
      .toBe("Usage limit reached on Grok, which was standing in for Claude. Sagax already moved this run twice, the most it does for one run. This run starts again on Claude at its reset, Nov 2, 3:17 PM (UTC).");
    expect(routineLimitWaitingText(cap, at, FR, "Claude"))
      .toBe("Limite d'utilisation atteinte sur Grok, qui remplaçait Claude. Sagax a déjà déplacé cette exécution deux fois, ce qui est le maximum. Cette exécution repart sur Claude à la réinitialisation de sa limite, le 2 nov. à 15 h 17 (UTC).");
    const off = { kind: "quota" as const, from: "Claude", noTaker: "off" as const };
    expect(routineLimitWaitingText(off, at, UTC))
      .toBe("Usage limit reached on Claude. Automatic switching to another engine is off on this server. This run starts again at the reset, Nov 2, 3:17 PM (UTC).");
    expect(routineLimitWaitingText(off, at, FR))
      .toBe("Limite d'utilisation atteinte sur Claude. Le passage automatique à un autre moteur est désactivé sur ce serveur. Cette exécution repart à la réinitialisation, le 2 nov. à 15 h 17 (UTC).");
  });

  it("gives the real reset time, or says the engine gave none", () => {
    const known = { kind: "quota" as const, from: "Claude", resetsAt: NOW + 3 * 24 * HOUR, estimated: false, noTaker: "none" as const };
    expect(routineLimitStoppedText(known, UTC))
      .toBe("Usage limit reached on Claude. No other engine can take over. Claude resets around Nov 5, 1:16 PM (UTC); runs on it work again then.");
    expect(routineLimitStoppedText(known, FR))
      .toBe("Limite d'utilisation atteinte sur Claude. Aucun autre moteur ne peut prendre le relais. Claude se réinitialise vers le 5 nov. à 13 h 16 (UTC) ; les exécutions sur ce moteur reprendront alors.");
    const unknown = { ...known, resetsAt: NOW + HOUR, estimated: true };
    const en = routineLimitStoppedText(unknown, UTC);
    expect(en).toBe("Usage limit reached on Claude. No other engine can take over. Claude gave no reset time; runs on it work again once it resets.");
    expect(en).not.toContain("2:16 PM");
    const fr = routineLimitStoppedText(unknown, FR);
    expect(fr).toBe("Limite d'utilisation atteinte sur Claude. Aucun autre moteur ne peut prendre le relais. Claude n'a pas donné d'heure de réinitialisation ; les exécutions sur ce moteur reprendront à sa réinitialisation.");
    // No other engine can take over: no advice to choose one.
    expect(en).not.toMatch(/choose another engine/i);
    expect(fr).not.toMatch(/autre moteur pour ce bot/i);
    plain(en);
    plain(fr);
  });

  it("names the bot's own engine and its reset when the engine that refused stood in for it", () => {
    const chain = { kind: "quota" as const, from: "Codex", resetsAt: NOW + 3 * HOUR, estimated: false, home: { name: "Claude", resetsAt: NOW + 3 * 24 * HOUR, estimated: false }, noTaker: "none" as const };
    const en = routineLimitStoppedText(chain, UTC);
    expect(en).toBe("Usage limit reached on Codex, which was standing in for Claude. No other engine can take over. Claude resets around Nov 5, 1:16 PM (UTC); runs on it work again then.");
    const fr = routineLimitStoppedText(chain, FR);
    expect(fr).toBe("Limite d'utilisation atteinte sur Codex, qui remplaçait Claude. Aucun autre moteur ne peut prendre le relais. Claude se réinitialise vers le 5 nov. à 13 h 16 (UTC) ; les exécutions sur ce moteur reprendront alors.");
    expect(en).not.toMatch(/choose another engine/i);
    plain(en);
    plain(fr);
  });

  it("advises choosing another engine for the bot only when automatic switching is off", () => {
    const off = { kind: "quota" as const, from: "Claude", resetsAt: NOW + 3 * 24 * HOUR, estimated: false, noTaker: "off" as const };
    expect(routineLimitStoppedText(off, UTC))
      .toBe("Usage limit reached on Claude. Automatic switching to another engine is off on this server. Claude resets around Nov 5, 1:16 PM (UTC); runs on it work again then. Or choose another engine for this bot now.");
    expect(routineLimitStoppedText(off, FR))
      .toBe("Limite d'utilisation atteinte sur Claude. Le passage automatique à un autre moteur est désactivé sur ce serveur. Claude se réinitialise vers le 5 nov. à 13 h 16 (UTC) ; les exécutions sur ce moteur reprendront alors. Ou choisissez dès maintenant un autre moteur pour ce bot.");
  });

  it("names the engine out of credit, and the bot's own engine when that one stood in for it", () => {
    const own = { kind: "quota" as const, from: "Codex", resetsAt: NOW + HOUR, estimated: true, noTaker: "none" as const };
    expect(routineLimitCreditsText(own, UTC)).toBe("The Codex account is out of credit. Add credit with the provider, or choose another engine for this bot.");
    expect(routineLimitCreditsText(own, FR)).toBe("Le compte Codex n'a plus de crédit. Ajoutez du crédit chez le fournisseur, ou choisissez un autre moteur pour ce bot.");
    const chain = { ...own, home: { name: "Claude", resetsAt: NOW + 3 * 24 * HOUR, estimated: false } };
    const en = routineLimitCreditsText(chain, UTC);
    expect(en).toBe("The Codex account, which was standing in for Claude, is out of credit. Claude resets around Nov 5, 1:16 PM (UTC); runs on it work again then.");
    expect(routineLimitCreditsText(chain, FR))
      .toBe("Le compte Codex, qui remplaçait Claude, n'a plus de crédit. Claude se réinitialise vers le 5 nov. à 13 h 16 (UTC) ; les exécutions sur ce moteur reprendront alors.");
    expect(en).not.toMatch(/choose another engine/i);
  });

  it("names no engine it cannot know, and says this run (never \"it\") starts again", () => {
    expect(routineLimitUnknownEngineText(UTC)).toBe("This run's engine reached its usage limit. Runs on it work again once it resets. Or choose another engine for this bot now.");
    expect(routineLimitUnknownEngineText(FR)).toBe("Le moteur de cette exécution a atteint sa limite d'utilisation. Les exécutions sur ce moteur reprendront à sa réinitialisation. Ou choisissez dès maintenant un autre moteur pour ce bot.");
    expect(routineLimitUnknownEngineText(UTC, NOW)).toBe("This run's engine reached its usage limit. This run starts again at the reset, Nov 2, 1:16 PM (UTC).");
    expect(routineLimitUnknownEngineText(FR, NOW)).toBe("Le moteur de cette exécution a atteint sa limite d'utilisation. Cette exécution repart à la réinitialisation, le 2 nov. à 13 h 16 (UTC).");
    plain(routineLimitUnknownEngineText(FR, NOW));
  });

  it("writes a time in the person's zone, with the zone named", () => {
    expect(limitWhen(NOW, { timeZone: "America/Toronto" })).toBe("Nov 2, 8:16 AM (America/Toronto)");
    expect(limitWhen(NOW, { language: "fr", timeZone: "America/Toronto" })).toBe("2 nov. à 8 h 16 (America/Toronto)");
  });
});
