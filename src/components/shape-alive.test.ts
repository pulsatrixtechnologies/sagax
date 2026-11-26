// The seats of the small mascots that live (#5404): who lives when a
// sidebar shows more mascots than the page can redraw thirty times a second.
import { describe, expect, it } from "vitest";
import { ALIVE_SEATS, ALIVE_TURN_SEATS, seatedNow, type AliveSeat } from "./shape-alive";

const seat = (extra: Partial<AliveSeat> = {}): AliveSeat => ({ visible: true, busy: false, seated: false, since: 0, last: 0, ...extra });

/** Applies what seatedNow decided, as the page does, at a given time. */
function apply(all: AliveSeat[], seats: number, rotate: boolean, at: number) {
  const sitting = seatedNow(all, seats, rotate);
  for (const entry of all) {
    const next = sitting.has(entry);
    if (next === entry.seated) continue;
    entry.seated = next;
    if (next) entry.since = at;
    else entry.last = at;
  }
}

describe("the seats of the small mascots that live", () => {
  it("lets every mascot on screen live while there are seats for all of them", () => {
    const all = Array.from({ length: ALIVE_SEATS }, () => seat());
    expect(seatedNow(all, ALIVE_SEATS, false).size).toBe(ALIVE_SEATS);
    // a turn changes nothing: nobody waits
    apply(all, ALIVE_SEATS, false, 1);
    expect([...seatedNow(all, ALIVE_SEATS, true)]).toEqual(all);
  });

  it("gives no seat to a mascot off screen, and takes it back when the mascot leaves the screen", () => {
    const on = seat();
    const off = seat({ visible: false });
    expect([...seatedNow([on, off], 4, false)]).toEqual([on]);
    const left = seat({ visible: false, seated: true, since: 1 });
    expect(seatedNow([left], 4, false).size).toBe(0);
  });

  it("never seats more mascots than there are seats", () => {
    const all = Array.from({ length: 30 }, () => seat());
    apply(all, ALIVE_SEATS, false, 1);
    expect(all.filter((entry) => entry.seated)).toHaveLength(ALIVE_SEATS);
    for (let turn = 2; turn < 40; turn += 1) {
      apply(all, ALIVE_SEATS, true, turn);
      expect(all.filter((entry) => entry.seated)).toHaveLength(ALIVE_SEATS);
    }
  });

  it("seats a bot that is doing something before a mascot at rest, taking the seat of the one that lived longest", () => {
    const first = seat({ seated: true, since: 1 });
    const second = seat({ seated: true, since: 2 });
    const working = seat({ busy: true });
    const sitting = seatedNow([first, second, working], 2, false);
    expect(sitting.has(working)).toBe(true);
    expect(sitting.has(second)).toBe(true);
    expect(sitting.has(first)).toBe(false);
    // a bot at work keeps its seat through the turns
    const all = [seat({ busy: true }), ...Array.from({ length: 9 }, () => seat())];
    apply(all, 3, false, 1);
    for (let turn = 2; turn < 20; turn += 1) {
      apply(all, 3, true, turn);
      expect(all[0]!.seated, `turn ${turn}`).toBe(true);
    }
  });

  it("makes the mascots at rest take turns: a few seats change hands on a turn, and every mascot lives in the end", () => {
    const all = Array.from({ length: 30 }, () => seat());
    apply(all, ALIVE_SEATS, false, 1);
    const lived = new Set(all.filter((entry) => entry.seated));
    let before = new Set(lived);
    for (let turn = 2; turn < 2 + Math.ceil((30 - ALIVE_SEATS) / ALIVE_TURN_SEATS); turn += 1) {
      apply(all, ALIVE_SEATS, true, turn);
      const sitting = new Set(all.filter((entry) => entry.seated));
      const arrived = [...sitting].filter((entry) => !before.has(entry));
      expect(arrived, `turn ${turn}`).toHaveLength(ALIVE_TURN_SEATS);
      for (const entry of sitting) lived.add(entry);
      before = sitting;
    }
    expect(lived.size).toBe(30);
  });

  it("without a turn, a mascot at rest keeps the seat it has", () => {
    const all = Array.from({ length: 20 }, () => seat());
    apply(all, ALIVE_SEATS, false, 1);
    const sitting = all.filter((entry) => entry.seated);
    apply(all, ALIVE_SEATS, false, 2);
    expect(all.filter((entry) => entry.seated)).toEqual(sitting);
  });
});
