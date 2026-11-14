// #4250 (S3): an engine's fix card ("Reconnect <engine>", the first fix item
// of section C point 5) follows the fix ladder: told once when raised, again
// a day later, then weekly while it stays open, each step once, a restart in
// the middle included. A card closed (the engine works again) is not told
// again.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { WireAccessCard } from "../../shared/wire.ts";
import { createTellPerson, settleKeyed, SignalLedger, signalKeys, signalLedgerDirStorage } from "../proactive/signal-ledger.ts";
import { engineFallbackCard, engineFallbackKey, remindEngineFallbacks, type OpenEngineFallback } from "./engine-fallback-card.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-11-02T13:00:00Z");
const KIND = "engine-fallback";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function world() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-engine-fix-"));
  dirs.push(dir);
  let clock = T0;
  const rings: Array<{ person: string; key: string; step: number }> = [];
  const open = new Map<string, OpenEngineFallback>();
  const ledgerAt = () => new SignalLedger({ storage: signalLedgerDirStorage(dir), now: () => clock, schedule: (fn) => fn() });
  let ledger = ledgerAt();
  const tell = () => createTellPerson<{ step: number }>({ ledger, notify: (n, item) => rings.push({ person: "", key: item.key, step: n.step }), log: () => {} });
  const raise = (person: string, key: string, card: OpenEngineFallback) => {
    open.set(`${person}\u0000${key}`, card);
    tell()(person, { key, kind: KIND, bot: card.access.botId, label: `Reconnect ${card.access.engine}`, notification: { step: 0 } });
  };
  const remind = () => remindEngineFallbacks({
    ledger,
    kind: KIND,
    pending: (key, person, threadId) => open.get(`${person}\u0000${threadId ? signalKeys.inHome(key, threadId) : key}`) ?? null,
    ring: (person, entry, _card, step) => { tell()(person, { key: entry.key, kind: KIND, bot: entry.bot, step, notification: { step } }); },
    now: () => clock,
  });
  return {
    get ledger() { return ledger; },
    rings, open, raise, remind,
    restart: () => { ledger = ledgerAt(); },
    later: (ms: number) => { clock += ms; },
  };
}

const access = (payer?: string): WireAccessCard => engineFallbackCard({
  botId: "b1", botName: "Nimbus", ownerPrincipalId: "pr_a", threadId: "t1",
  engine: { engine: "eng-1", name: "Engine One", ...(payer ? { account: JSON.stringify(["subscription", payer, "primary"]) } : {}) },
  backupName: "Backup", cause: "signed_out",
});

describe("an engine fix card follows the fix ladder (#4250 S3)", () => {
  it("told again after a day, then weekly, each step once, a restart in the middle included", () => {
    const w = world();
    const key = engineFallbackKey("eng-1");
    w.raise("pr_a", key, { threadId: "t1", access: access("pr_a"), text: "Engine One is signed out" });
    expect(w.rings.map((ring) => ring.step)).toEqual([0]);

    w.later(23 * HOUR);
    w.remind();
    expect(w.rings).toHaveLength(1);

    w.later(HOUR);
    w.remind();
    w.remind();
    expect(w.rings.map((ring) => ring.step)).toEqual([0, 1]);

    // a restart: the step told is on disk, nothing rings again
    w.restart();
    w.remind();
    expect(w.rings.map((ring) => ring.step)).toEqual([0, 1]);

    w.later(6 * DAY);
    w.remind();
    expect(w.rings).toHaveLength(2);
    w.later(DAY);
    w.restart();
    w.remind();
    w.remind();
    expect(w.rings.map((ring) => ring.step)).toEqual([0, 1, 2]);

    // the server was down three weeks: the missed steps ring once
    w.later(21 * DAY);
    w.restart();
    w.remind();
    w.remind();
    expect(w.rings.map((ring) => ring.step)).toEqual([0, 1, 2, 5]);
  });

  it("a closed card is not told again: the engine works again, or the card is gone", () => {
    const w = world();
    const key = engineFallbackKey("eng-1");
    w.raise("pr_a", key, { threadId: "t1", access: access("pr_a"), text: "Engine One is signed out" });
    w.open.clear();
    w.later(2 * DAY);
    w.remind();
    expect(w.rings).toHaveLength(1);

    const v = world();
    v.raise("pr_a", key, { threadId: "t1", access: access("pr_a"), text: "Engine One is signed out" });
    settleKeyed(v.ledger, { kind: KIND, key }, "retired");
    v.later(2 * DAY);
    v.remind();
    expect(v.rings).toHaveLength(1);
  });

  it("a server engine's card rings again in each administrators' home", () => {
    const w = world();
    const key = engineFallbackKey("eng-1");
    for (const thread of ["home-1", "home-2"]) {
      w.raise("server", signalKeys.inHome(key, thread), { threadId: thread, access: access(), text: "Engine One is signed out" });
    }
    w.later(DAY);
    w.remind();
    w.remind();
    expect(w.rings.map((ring) => `${ring.key}:${ring.step}`)).toEqual([
      `${key}@home-1:0`, `${key}@home-2:0`, `${key}@home-1:1`, `${key}@home-2:1`,
    ]);
  });
});
