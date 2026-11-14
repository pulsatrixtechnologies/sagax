// #3423: the watches walk the person's choices (the stopgap constant of
// #3416 is gone). #4250 (S5 `one-probe-engine`): a chosen watch is a routine
// of the carrying bot, read through the one probe engine; the watch loop and
// its timer are gone. Reads the source of server/index.ts as text: importing
// it would start the whole server.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const INDEX = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

describe("Pulsatrix watch wiring", () => {
  const source = readFileSync(INDEX, "utf8");
  const block = source.slice(source.indexOf("const flowWatches = new FlowWatches({"), source.indexOf("const flowWatches = new FlowWatches({") + 4_000);

  it("has no switch of its own any more: the person's choice is the switch", () => {
    expect(source).not.toMatch(/PULSATRIX_WATCHES_ENABLED/);
  });

  it("walks the people's choices, never the stored mode of every bot", () => {
    expect(block).toMatch(/choices: \(\) => proactiveChoices\.chosen\(\)/);
    expect(block.slice(0, 600)).not.toMatch(/store\.bots/);
  });

  it("#4250: has no watch loop and no timer of its own; its routines' code check reads through the one probe engine", () => {
    expect(source).not.toMatch(/flowWatchLoop|FlowWatchLoop|WATCH_TICK_MS/);
    expect(block).toMatch(/evaluate: \(routine, precheck\) => routineWatchEvaluator\(routine, precheck\)/);
    expect(source).toMatch(/if \(precheck\.check === FLOW_WATCH_CHECK\) return flowWatches\.check\(routine\);/);
    // its readings are kept with the other watches' (never pruned as orphans)
    expect(source).toMatch(/routineWatchStates\.prune\([^\n]*FLOW_WATCH_CHECK/);
  });

  it("#4250: the routines follow the person's choices, at start and within the hour on a pass the server already makes", () => {
    expect(source).toMatch(/proactiveChoices\.onChange = \(person\) => \{ void flowWatches\.sync\(person\)/);
    expect(source).toMatch(/void flowWatches\.syncAll\(\)/);
    expect(source).toMatch(/briefCardsPass\(\);[\s\S]{0,300}void flowWatches\.syncStale\(\)/);
  });
});

/** #4250: "a count of timers in the server". The Flow watch loop's timer
 * is gone; each later step of S5 lowers this number again. */
export const SERVER_INTERVALS = 26;

describe("#4250: the timers of the server", () => {
  it(`server/index.ts starts at most ${SERVER_INTERVALS} intervals`, () => {
    const source = readFileSync(INDEX, "utf8");
    expect([...source.matchAll(/\bsetInterval\(/g)].length).toBeLessThanOrEqual(SERVER_INTERVALS);
  });
});
