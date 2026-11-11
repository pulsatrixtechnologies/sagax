// #3564: the bot-computer sessions an earlier run of the server left connected
// are found again from the session store (the support code stays there) and
// closed through the usual close, which ends them at the gateway.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Store } from "../store.ts";
import { TerminalResourceRegistry } from "../terminal-resources/registry.ts";
import { createRemoteSessionService } from "./remote-sessions.ts";
import { HOST_SESSION_LIFE_MS } from "./host-gateway-bound.ts";
import { rememberSession } from "./remote-support-local.ts";
import type { RunCommand } from "./remote-session-probe.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const temp = (prefix: string) => { const dir = mkdtempSync(path.join(tmpdir(), prefix)); roots.push(dir); return dir; };

const stored = (over: Record<string, unknown>) => ({ id: "0123456789ab", botId: "bot-1", threadId: "t", principalId: "person-a", code: "BQDHS7", os: "linux", elevated: false, endAt: "2099-01-01T00:00:00.000Z", state: "connected", quiet: true, createdAt: 1, ...over });

const ADDRESS = "tcABCDEFGHJKMNPQRSTUVWXYZ234567890abcd";

/** A support folder as remote_support_open leaves it, owned by person-a and bot-1. */
async function supportFolder() {
  const dir = temp("sagax-support-");
  await rememberSession(dir, "BQDHS7", "0123456789ab", { rights: "standard", end_at: new Date(Date.now() + 2 * 3_600_000).toISOString(), principalId: "person-a", botId: "bot-1" });
  mkdirSync(path.join(dir, "sessions", "BQDHS7"), { recursive: true });
  writeFileSync(path.join(dir, "sessions", "BQDHS7", "technician.private.json"), "{}\n", { mode: 0o600 });
  writeFileSync(path.join(dir, "sessions", "BQDHS7", "address"), `${ADDRESS}\n`, { mode: 0o600 });
  return dir;
}

function boot(rows: Record<string, unknown>[], extra: { supportDir?: string; run?: RunCommand; closeRemote?: () => Promise<unknown>; now?: () => number } = {}) {
  const dataDir = temp("sagax-data-");
  writeFileSync(path.join(dataDir, "remote-sessions.json"), JSON.stringify({ sessions: rows }));
  return createRemoteSessionService({
    dataDir,
    supportDir: () => extra.supportDir ?? temp("sagax-support-"),
    store: { bot: () => null, appendMessage: () => ({ id: "m" }), patchMessage: () => null } as unknown as Store,
    registry: new TerminalResourceRegistry(),
    sessions: { open: async () => ({ id: "term-1", status: "connecting" }) } as never,
    access: () => ({ organization: true, admin: false, ownsBot: true }),
    owner: () => "person-a",
    run: extra.run ?? (async () => ({ code: 0, stdout: "", stderr: "" })),
    home: () => temp("sagax-flow-"),
    ...(extra.closeRemote ? { closeRemote: extra.closeRemote } : {}),
    ...(extra.now ? { now: extra.now } : {}),
  });
}

describe("sessions left by an earlier run (#3564)", () => {
  it("lists the person's own connected bot-computer sessions of the store, not the others", () => {
    const svc = boot([
      stored({}),
      stored({ id: "111111111111", principalId: "person-b" }),
      stored({ id: "222222222222", quiet: false }),
      stored({ id: "333333333333", state: "ended" }),
    ]);
    expect(svc.inherited("person-a")).toEqual([{ botId: "bot-1", id: "0123456789ab", stale: true }]);
    expect(svc.inherited("person-b")).toEqual([{ botId: "bot-1", id: "111111111111", stale: true }]);
  });

  it("empties once the session is closed", async () => {
    const svc = boot([stored({})]);
    await svc.close("person-a", "bot-1", "0123456789ab");
    expect(svc.inherited("person-a")).toEqual([]);
  });

  it("a stop sends the gateway close at once, even while the tunnel stop is still running", async () => {
    const dir = await supportFolder();
    const closeRemote = vi.fn(async () => undefined);
    const svc = boot([stored({ quiet: false, createdAt: Date.now() })], { supportDir: dir, run: () => new Promise(() => undefined), closeRemote });
    void svc.close("person-a", "bot-1", "0123456789ab", { gatewayFirst: true });
    await vi.waitFor(() => expect(closeRemote).toHaveBeenCalledTimes(1), { timeout: 2_000 });
  });

  it("a leftover older than a session's life is cleared with no stop command and no gateway call", async () => {
    const dir = await supportFolder();
    const closeRemote = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    const svc = boot([stored({ createdAt: Date.now() - HOST_SESSION_LIFE_MS - 1_000 })], { supportDir: dir, run, closeRemote });
    const [one] = svc.inherited("person-a");
    expect(one).toMatchObject({ id: "0123456789ab", stale: true });
    await svc.close("person-a", "bot-1", one!.id, { stale: true });
    expect(closeRemote).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(svc.inherited("person-a")).toEqual([]);
  });

  it("a gateway close that fails is tried once more, then let go", async () => {
    const dir = await supportFolder();
    const closeRemote = vi.fn(async () => { throw new Error("down"); });
    const failed = vi.fn();
    const svc = boot([stored({ createdAt: Date.now() })], { supportDir: dir, closeRemote });
    await svc.close("person-a", "bot-1", "0123456789ab", { onGatewayFailed: failed });
    expect(failed).toHaveBeenCalledTimes(1);
    expect(svc.inherited("person-a")).toEqual([{ botId: "bot-1", id: "0123456789ab", stale: false }]);
    await svc.close("person-a", "bot-1", "0123456789ab", { onGatewayFailed: failed });
    expect(closeRemote).toHaveBeenCalledTimes(2);
    expect(svc.inherited("person-a")).toEqual([]);
    await svc.close("person-a", "bot-1", "0123456789ab");
    expect(closeRemote).toHaveBeenCalledTimes(2);
  });
});
