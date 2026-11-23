import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { removeTempDir } from "./testing/cleanup.ts";

const spawn = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn };
});

import { stagedCloudflaredPath } from "../electron/managed-companion-tunnel.mjs";
import { ensureCloudflared } from "./tunnel.ts";

function exitZero() {
  const child = new EventEmitter();
  queueMicrotask(() => child.emit("exit", 0));
  return child;
}

describe("ensureCloudflared", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    spawn.mockReset();
    for (const dir of dirs.splice(0)) await removeTempDir(dir);
  });

  it("refreshes a connector already staged in the data dir", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sagax-cloudflared-"));
    dirs.push(dataDir);
    const staged = stagedCloudflaredPath({ appPath: dataDir });
    mkdirSync(join(staged, ".."), { recursive: true });
    writeFileSync(staged, "");
    spawn.mockImplementation(exitZero);
    const binary = await ensureCloudflared({ dataDir, env: {}, log: () => {} });
    expect(binary).toBe(staged);
    expect(spawn).toHaveBeenCalledOnce();
    const args = spawn.mock.calls[0]?.[1] as string[];
    expect(args).toContain("--current");
    expect(args).toContain(dataDir);
  });

  it("leaves an explicit connector path alone", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sagax-cloudflared-"));
    dirs.push(dataDir);
    const pinned = join(dataDir, "cloudflared");
    writeFileSync(pinned, "");
    const binary = await ensureCloudflared({ dataDir, env: { SAGAX_CLOUDFLARED_PATH: pinned }, log: () => {} });
    expect(binary).toBe(pinned);
    expect(spawn).not.toHaveBeenCalled();
  });
});
