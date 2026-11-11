// #3564: the bot-computer sessions an earlier run of the server left connected
// are found again from the session store (the support code stays there) and
// closed through the usual close, which ends them at the gateway.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Store } from "../store.ts";
import { TerminalResourceRegistry } from "../terminal-resources/registry.ts";
import { createRemoteSessionService } from "./remote-sessions.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const temp = (prefix: string) => { const dir = mkdtempSync(path.join(tmpdir(), prefix)); roots.push(dir); return dir; };

const stored = (over: Record<string, unknown>) => ({ id: "0123456789ab", botId: "bot-1", threadId: "t", principalId: "person-a", code: "BQDHS7", os: "linux", elevated: false, endAt: "2099-01-01T00:00:00.000Z", state: "connected", quiet: true, createdAt: 1, ...over });

function boot(rows: Record<string, unknown>[]) {
  const dataDir = temp("sagax-data-");
  writeFileSync(path.join(dataDir, "remote-sessions.json"), JSON.stringify({ sessions: rows }));
  return createRemoteSessionService({
    dataDir,
    supportDir: () => temp("sagax-support-"),
    store: { bot: () => null, appendMessage: () => ({ id: "m" }), patchMessage: () => null } as unknown as Store,
    registry: new TerminalResourceRegistry(),
    sessions: { open: async () => ({ id: "term-1", status: "connecting" }) } as never,
    access: () => ({ organization: true, admin: false, ownsBot: true }),
    owner: () => "person-a",
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
    home: () => temp("sagax-flow-"),
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
    expect(svc.inherited("person-a")).toEqual([{ botId: "bot-1", id: "0123456789ab" }]);
    expect(svc.inherited("person-b")).toEqual([{ botId: "bot-1", id: "111111111111" }]);
  });

  it("empties once the session is closed", async () => {
    const svc = boot([stored({})]);
    await svc.close("person-a", "bot-1", "0123456789ab");
    expect(svc.inherited("person-a")).toEqual([]);
  });
});
