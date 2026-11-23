import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The process entrypoint is server/index.ts. Learned routing was left out of
 * it while the credential resolver landed. These assertions hold the wiring. */
const index = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const turns = readFileSync(new URL("../runtime-events/turn-completed.ts", import.meta.url), "utf8");

describe("learned routing is wired into the running server", () => {
  it("passes the data directory into the account switch and reads the person's own switch", () => {
    const start = index.indexOf("const accountSwitch = createAccountSwitch({");
    expect(start).toBeGreaterThan(-1);
    const end = index.indexOf("});", start);
    const block = index.slice(start, end);
    expect(block).toContain("learnedDataDir: DATA_DIR");
    expect(block).toContain("learnedRouting:");
    expect(block).not.toContain("SAGAX_LEARNED_ROUTING");
    expect(index).not.toContain("SAGAX_LEARNED_ROUTING");
  });

  it("records a settled turn through the account switch", () => {
    expect(index).toContain("accountSwitch.record(");
    expect(turns).toContain("recordLearnedTurn");
  });
});
