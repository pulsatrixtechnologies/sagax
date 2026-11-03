import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CLOUD_ONLY_BOTS_FILE, cloudOnlyBot } from "./cloud-only-bots.ts";
import { remoteComputerForTurn } from "../sandbox/user-sandbox-routing.ts";
import { resolveSurface } from "../surface.ts";

const dir = () => mkdtempSync(join(tmpdir(), "cloud-only-"));

it("lists bots by id or all, and treats a missing or broken file as none", () => {
  const d = dir();
  expect(cloudOnlyBot("a", d)).toBe(false);
  writeFileSync(join(d, CLOUD_ONLY_BOTS_FILE), JSON.stringify({ bots: ["a"] }));
  expect(cloudOnlyBot("a", d)).toBe(true);
  expect(cloudOnlyBot("b", d)).toBe(false);
  expect(cloudOnlyBot(undefined, d)).toBe(false);
  writeFileSync(join(d, CLOUD_ONLY_BOTS_FILE), JSON.stringify({ bots: "all" }));
  expect(cloudOnlyBot("b", d)).toBe(true);
  for (const bad of ["{", "[]", JSON.stringify({ bots: "a" }), JSON.stringify({ bots: [1] })]) {
    writeFileSync(join(d, CLOUD_ONLY_BOTS_FILE), bad);
    expect(cloudOnlyBot("a", d)).toBe(false);
  }
});

it("a cloud-only turn is fixed to the cloud: no Auto choice, no computer pin", () => {
  // what index.ts does with it: the turn runs as a cloud run
  const remote = remoteComputerForTurn({ organization: true, runOnCloud: true, hasTeamComputer: false });
  expect(remote.forceCloud).toBe(true);
  const plan = resolveSurface({ destination: remote.forceCloud ? "cloud" : undefined, pinnedSurface: null, browserOn: false });
  expect(plan.computer).toBe("cloud");
  expect(resolveSurface({ destination: remote.forceCloud ? "cloud" : "local", pinnedSurface: null, browserOn: false }).computer).toBe("cloud");
});
