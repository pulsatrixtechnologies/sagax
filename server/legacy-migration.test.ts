// A user upgrading from the pre-rename data dir (~/.opengrokbot) must find
// everything in ~/.sagax after the first boot. Anything that touches
// the new dir before ensureDirs() runs would make that rename a no-op and
// boot the user into an empty workspace — this test pins the order.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";
import { waitForServerReady } from "./testing/server-ready.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const PORT = await freePortBlock([0, 1]);
const WEBHOOK_PORT = await freePortBlock([0], 39_000, 10_000);

let home: string;
let child: ChildProcess;
let stderr = "";

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-legacy-test-"));
  const legacy = join(home, ".opengrokbot");
  mkdirSync(legacy, { recursive: true });
  // A non-product shadow keeps startup deterministic: an empty map selects
  // the user's full default engine fleet, whose installed CLI probes are not
  // part of this migration test.
  writeFileSync(join(legacy, "config.json"), JSON.stringify({
    instances: { fixture: { driver: "migration-test-shadow" } },
  }));
  writeFileSync(join(legacy, "keep-me.txt"), "carried over");
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home,
      USERPROFILE: home,
      OMB_PORT: String(PORT),
      OMB_WEBHOOK_PORT: String(WEBHOOK_PORT),
      OMB_BROWSER_CONNECTION: join(home, "browser-test-connection.json"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
  // Ready when this child's health answers, not after a fixed 20 s: a cold
  // strip-types boot of index.ts on a shared build VM (8 cores, several gates
  // at once) took longer than that and failed the whole file.
  await waitForServerReady(child, `http://127.0.0.1:${PORT}`, () => stderr);
}, 90_000);

afterAll(async () => {
  await waitForExit(child, { signal: "SIGTERM" });
  await removeTempDir(home);
});

describe("legacy data dir", () => {
  it("is renamed to the new name on first boot, with its contents and a fresh environment id", () => {
    const fresh = join(home, ".sagax");
    expect(existsSync(join(home, ".opengrokbot"))).toBe(false);
    expect(readFileSync(join(fresh, "keep-me.txt"), "utf8")).toBe("carried over");
    expect(readFileSync(join(fresh, "environment-id"), "utf8").trim()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
