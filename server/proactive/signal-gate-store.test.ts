import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { signalGateFileStorage } from "./signal-gate-store.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("signal gate file (#2695)", () => {
  it("saves and reads back the day's count, owner only", () => {
    const dir = mkdtempSync(join(tmpdir(), "signal-gate-"));
    dirs.push(dir);
    const path = join(dir, "signal-gate.json");
    const storage = signalGateFileStorage(path);
    expect(storage.load()).toBeNull();
    storage.save({ p1: { day: "2026-11-08", sent: 3, held: [{ at: 1, title: "Rapport", body: "ok" }] } });
    expect(signalGateFileStorage(path).load()).toEqual({ p1: { day: "2026-11-08", sent: 3, held: [{ at: 1, title: "Rapport", body: "ok" }] } });
    expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(1);
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
