// The words a run says when a limit refused its turn (server/routines/routine-limit-words.ts),
// in English and Quebec French. They are the run's status line, its notification
// and the Team incidents report a Primary Bot relays: they name the engine that
// refused, say where the run went on, give the real reset, and never claim a run
// is down while another engine runs it.
import { describe, expect, it } from "vitest";

import {
  limitWhen, routineLimitStoppedText, routineLimitSwitchedText, routineLimitUnknownEngineText, routineLimitWaitingText,
  type RoutineUsageLimit,
} from "./routine-limit-words.ts";

const NOW = Date.UTC(2026, 10, 2, 13, 16);
const UTC = { timeZone: "UTC" };
const FR = { language: "fr-CA", timeZone: "UTC" };
const codex: RoutineUsageLimit = { kind: "quota", from: "Codex (gpt-6.1-luna)", resetsAt: NOW + 2 * 3_600_000, estimated: false };

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

  it("says the same in Quebec French", () => {
    const text = routineLimitSwitchedText({ ...codex, from: "Codex", to: "Grok" }, FR);
    expect(text).toBe("Limite d'utilisation atteinte sur Codex : cette exécution continue sur Grok. Retour sur Codex à sa réinitialisation, vers le 2 nov., 15 h 16 (UTC).");
    plain(text);
  });

  it("calls a rate limit a rate limit, and an estimated reset an estimate", () => {
    const rate: RoutineUsageLimit = { kind: "rate_limited", from: "Claude", resetsAt: NOW + 15 * 60_000, estimated: true };
    const en = routineLimitSwitchedText({ ...rate, to: "Codex" }, UTC);
    expect(en).toBe("Rate limit reached on Claude: this run continues on Codex. Claude gave no reset time: it is tried again around Nov 2, 1:31 PM (UTC).");
    expect(en).not.toMatch(/usage limit/i);
    const fr = routineLimitSwitchedText({ ...rate, to: "Codex" }, FR);
    expect(fr).toBe("Limite de débit atteinte sur Claude : cette exécution continue sur Codex. Claude n'a pas donné d'heure de réinitialisation : il sera réessayé vers le 2 nov., 13 h 31 (UTC).");
    plain(en);
    plain(fr);
  });

  it("names Auto's next pick when the bot is on Auto", () => {
    expect(routineLimitSwitchedText({ ...codex, from: "Claude", to: "Auto" }, UTC))
      .toBe("Usage limit reached on Claude: Auto continues it on another model. Back on Claude once it resets, around Nov 2, 3:16 PM (UTC).");
    expect(routineLimitSwitchedText({ ...codex, from: "Claude", to: "Auto" }, FR))
      .toBe("Limite d'utilisation atteinte sur Claude : Auto poursuit cette exécution sur un autre modèle. Retour sur Claude à sa réinitialisation, vers le 2 nov., 15 h 16 (UTC).");
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
    expect(fr).toBe("Limite d'utilisation atteinte sur Codex (gpt-6.1-luna) : cette exécution continue sur Grok. Sagax évite Codex (gpt-6.1-luna) pour les tours rapides jusqu'à sa réinitialisation, vers le 2 nov., 15 h 16 (UTC).");
    expect(fr).not.toMatch(/retour sur/i);
    plain(en);
    plain(fr);
  });

  it("names Sagax's estimate as one when the engine gave no reset time", () => {
    const guessed = { ...detour, resetsAt: NOW + 3_600_000, estimated: true };
    expect(routineLimitSwitchedText({ ...guessed, to: "Grok" }, UTC))
      .toBe("Usage limit reached on Codex (gpt-6.1-luna): this run continues on Grok. Codex (gpt-6.1-luna) gave no reset time: Sagax skips it for quick turns until around Nov 2, 2:16 PM (UTC).");
    expect(routineLimitSwitchedText({ ...guessed, to: "Grok" }, FR))
      .toBe("Limite d'utilisation atteinte sur Codex (gpt-6.1-luna) : cette exécution continue sur Grok. Codex (gpt-6.1-luna) n'a pas donné d'heure de réinitialisation : Sagax l'évite pour les tours rapides jusque vers le 2 nov., 14 h 16 (UTC).");
  });

  it("never advises choosing another engine for the bot when nothing could take the run", () => {
    const en = routineLimitStoppedText(detour, UTC);
    expect(en).toBe("Usage limit reached on Codex (gpt-6.1-luna) and no other engine could take this run. Sagax skips Codex (gpt-6.1-luna) for quick turns until it resets, around Nov 2, 3:16 PM (UTC).");
    const fr = routineLimitStoppedText(detour, FR);
    expect(fr).toBe("Limite d'utilisation atteinte sur Codex (gpt-6.1-luna) et aucun autre moteur n'a pu prendre en charge cette exécution. Sagax évite Codex (gpt-6.1-luna) pour les tours rapides jusqu'à sa réinitialisation, vers le 2 nov., 15 h 16 (UTC).");
    expect(en).not.toMatch(/choose another engine/i);
    expect(fr).not.toMatch(/autre moteur pour ce bot/i);
    plain(en);
    plain(fr);
  });
});

describe("a run no other engine could take", () => {
  it("waits for the reset and says when it starts again", () => {
    const at = NOW + 2 * 3_600_000 + 60_000;
    const en = routineLimitWaitingText({ kind: "quota", from: "Claude" }, at, UTC);
    expect(en).toBe("Usage limit reached on Claude and no other engine can take this run: it starts again at the reset, Nov 2, 3:17 PM (UTC).");
    const fr = routineLimitWaitingText({ kind: "quota", from: "Claude" }, at, FR);
    expect(fr).toBe("Limite d'utilisation atteinte sur Claude et aucun autre moteur ne peut prendre en charge cette exécution : elle repart à la réinitialisation, le 2 nov., 15 h 17 (UTC).");
    plain(en);
    plain(fr);
  });

  it("gives the real reset time, or says the engine gave none, and what to do", () => {
    const known = { kind: "quota" as const, from: "Claude", resetsAt: NOW + 3 * 24 * 3_600_000, estimated: false };
    expect(routineLimitStoppedText(known, UTC))
      .toBe("Usage limit reached on Claude and no other engine could take this run. Claude resets around Nov 5, 1:16 PM (UTC); runs on it work again then. Or choose another engine for this bot now.");
    expect(routineLimitStoppedText(known, FR))
      .toBe("Limite d'utilisation atteinte sur Claude et aucun autre moteur n'a pu prendre en charge cette exécution. Claude se réinitialise vers le 5 nov., 13 h 16 (UTC) ; les exécutions sur ce moteur reprendront alors. Ou choisissez dès maintenant un autre moteur pour ce bot.");
    const unknown = { ...known, resetsAt: NOW + 3_600_000, estimated: true };
    const en = routineLimitStoppedText(unknown, UTC);
    expect(en).toBe("Usage limit reached on Claude and no other engine could take this run. Claude gave no reset time; runs on it work again once it resets. Or choose another engine for this bot now.");
    expect(en).not.toContain("2:16 PM");
    const fr = routineLimitStoppedText(unknown, FR);
    expect(fr).toBe("Limite d'utilisation atteinte sur Claude et aucun autre moteur n'a pu prendre en charge cette exécution. Claude n'a pas donné d'heure de réinitialisation ; les exécutions sur ce moteur reprendront à sa réinitialisation. Ou choisissez dès maintenant un autre moteur pour ce bot.");
    plain(en);
    plain(fr);
  });

  it("names no engine it cannot know", () => {
    expect(routineLimitUnknownEngineText(UTC)).toBe("This run's engine reached its usage limit. Runs on it work again once it resets. Or choose another engine for this bot now.");
    expect(routineLimitUnknownEngineText(FR)).toBe("Le moteur de cette exécution a atteint sa limite d'utilisation. Les exécutions sur ce moteur reprendront à sa réinitialisation. Ou choisissez dès maintenant un autre moteur pour ce bot.");
    expect(routineLimitUnknownEngineText(UTC, NOW)).toBe("This run's engine reached its usage limit. It starts again at the reset, Nov 2, 1:16 PM (UTC).");
    plain(routineLimitUnknownEngineText(FR, NOW));
  });

  it("writes a time in the person's zone, with the zone named", () => {
    expect(limitWhen(NOW, { timeZone: "America/Toronto" })).toBe("Nov 2, 8:16 AM (America/Toronto)");
    expect(limitWhen(NOW, { language: "fr", timeZone: "America/Toronto" })).toBe("2 nov., 8 h 16 (America/Toronto)");
  });
});
