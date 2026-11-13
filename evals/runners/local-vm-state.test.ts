import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeTempDir } from "../../server/testing/cleanup.ts";
import { LocalVmWorld } from "./local-vm-world.ts";

// Issue #4090: the server under test reads the VM state file synchronously
// from timers (the turn watchdog every 30 ms, the lease clock) and parses it
// with no guard, so one torn read throws out of a timer and kills the
// server. lazy-claim-rejection flips the state right before its first gate
// call, and now and then that call met a dead server: "fetch failed". The
// world must only ever expose a whole state file to that reader.
const READER = `
const { readFileSync } = require("node:fs");
const file = process.argv[1];
const until = Date.now() + Number(process.argv[2]);
let reads = 0, torn = 0;
while (Date.now() < until) {
  reads += 1;
  try { JSON.parse(readFileSync(file, "utf8")); } catch { torn += 1; }
}
process.stdout.write(JSON.stringify({ reads, torn }));
`;

let home = "";

afterEach(async () => {
  if (home) await removeTempDir(home);
  home = "";
});

describe("localVm world state file", () => {
  it("never shows a concurrent reader a partial state file", async () => {
    home = mkdtempSync(join(tmpdir(), "omb-evals-vm-state-"));
    const stateFile = join(home, "vm.json");
    writeFileSync(stateFile, "{}");
    const world = new LocalVmWorld();
    (world as unknown as { stateFile: string }).stateFile = stateFile;
    const ctx = { sends: [], observations: {} };
    const durationMs = 1_500;
    const reader = spawn(process.execPath, ["-e", READER, stateFile, String(durationMs)], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    reader.stdout.on("data", (chunk) => (out += chunk));
    const exited = new Promise<void>((resolve) => reader.once("exit", () => resolve()));
    const padding = "x".repeat(64 * 1024);
    const stop = Date.now() + durationMs;
    for (let flip = 0; Date.now() < stop; flip += 1) {
      await world.runStep({ kind: "setVmState", state: { failed: flip % 2 === 0, padding } }, ctx);
      if (flip % 50 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
    await exited;
    const { reads, torn } = JSON.parse(out) as { reads: number; torn: number };
    expect(reads).toBeGreaterThan(0);
    expect(torn).toBe(0);
  }, 20_000);
});
