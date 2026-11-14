// #4250 (S5 `one-probe-engine`): one probe engine. A Flow watch the person
// turned on (step a) and a bot's HEARTBEAT.md checklist (step b) are
// pre-checks of routines; the routine scheduler runs them, and the loops'
// own timers are gone. Reads the source of server/index.ts as text:
// importing it would start the whole server.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const INDEX = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const source = readFileSync(INDEX, "utf8");

/** "A count of timers in the server": 27 before S5; the Flow watch loop's
 * timer (step a) and the heartbeat timer (step b) are gone. */
export const SERVER_INTERVALS = 25;

describe("#4250: the timers of the server", () => {
  it(`server/index.ts starts at most ${SERVER_INTERVALS} intervals`, () => {
    expect([...source.matchAll(/\bsetInterval\(/g)].length).toBeLessThanOrEqual(SERVER_INTERVALS);
  });

  it("no timer beats the heartbeat or ticks the Flow watches", () => {
    expect(source).not.toMatch(/heartbeat\.tick\(|flowWatchLoop|WATCH_TICK_MS/);
  });
});

describe("#4250 step b: the checklist is a routine's pre-check", () => {
  it("the routines' code check runs the checklist's probes", () => {
    expect(source).toMatch(/if \(precheck\.check === HEARTBEAT_CHECK\) return heartbeat\.check\(routine\);/);
  });

  it("the routine follows HEARTBEAT.md: at start, on each journaled edit, and within the hour on a pass the server already makes", () => {
    expect(source).toMatch(/heartbeat\.syncAll\(\)/);
    expect(source).toMatch(/onMemoryChange\(\(botId, path\) => \{\n\s*if \(path === HEARTBEAT_PATH\) heartbeat\.sync\(botId\);/);
    expect(source).toMatch(/briefCardsPass\(\);[\s\S]{0,600}heartbeat\.syncDue\(\)/);
  });
});
