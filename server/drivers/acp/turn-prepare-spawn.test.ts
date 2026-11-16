// #4394: ordinary turns on a hosted server started an engine every time
// (path=spawn) and nothing said why: the reason now rides the turn's latency
// line (spawnWhy). Here the session selection alone, with a fake process.
import { afterEach, describe, expect, it, vi } from "vitest";
import { warmResources } from "../../resources/warm-resources.ts";
import { prepareAcpSpawn, type AcpSpawnDeps } from "./turn-prepare-spawn.ts";
import { noteEngineClosed, noteEngineExited, takeEngineClosed } from "./turn-latency.ts";
import type { AcpSession } from "./types.ts";

function fakeSession(contractKey: string): AcpSession {
  return { contractKey, sessionKey: "", sessionId: "s1", dead: false, closing: false, idleTimer: null, child: { pid: undefined, exitCode: null } } as unknown as AcpSession;
}

function deps(sessions: Map<string, AcpSession>, overrides: Partial<AcpSpawnDeps> = {}): AcpSpawnDeps {
  return {
    support: { spawnArgs: () => ["agent"] },
    turn: { botId: "bot" }, turnConfig: {}, cliTurn: {}, approvalGated: false,
    launch: { command: "engine" }, env: { A: "1" }, cwd: "/work", accountModels: null,
    openSession: (_thread: string, _launch: unknown, _args: unknown, _env: unknown, _cwd: unknown, contractKey: string) => fakeSession(contractKey),
    threadId: "thread-1", active: new Map(), warming: new Map(), sessions,
    closeSession: (threadId: string, why: string) => { noteEngineClosed(threadId, why); sessions.delete(threadId); },
    sessionAllows: new Map(), sessionServersKey: [],
    ...overrides,
  };
}

afterEach(() => { takeEngineClosed("thread-1"); vi.restoreAllMocks(); });

describe("why a turn starts an engine (#4394)", () => {
  it("says nothing when the warm engine takes the turn", () => {
    vi.spyOn(warmResources, "register").mockReturnValue({ active: () => true, retiring: () => {} } as never);
    const sessions = new Map<string, AcpSession>();
    const first = prepareAcpSpawn(deps(sessions));
    expect(first.spawnWhy).toBe("first");
    const second = prepareAcpSpawn(deps(sessions));
    expect(second.session).toBe(first.session);
    expect(second.spawnWhy).toBeUndefined();
  });

  it("names the close that let the last engine go, and a contract that changed", () => {
    vi.spyOn(warmResources, "register").mockReturnValue({ active: () => true, retiring: () => {} } as never);
    const sessions = new Map<string, AcpSession>();
    prepareAcpSpawn(deps(sessions));
    noteEngineClosed("thread-1", "idle");
    sessions.delete("thread-1");
    expect(prepareAcpSpawn(deps(sessions)).spawnWhy).toBe("closed:idle");
    expect(prepareAcpSpawn(deps(sessions, { env: { A: "2" } })).spawnWhy).toBe("contract:envFingerprint");
    sessions.get("thread-1")!.dead = true;
    expect(prepareAcpSpawn(deps(sessions, { env: { A: "2" } })).spawnWhy).toBe("exited");
    expect(prepareAcpSpawn(deps(sessions, { env: { A: "2" }, turn: { botId: "bot", sessionReset: true } })).spawnWhy).toBe("reset");
  });

  it("names a process that ended on its own, and one kept under another engine (#4394)", () => {
    vi.spyOn(warmResources, "register").mockReturnValue({ active: () => true, retiring: () => {} } as never);
    const sessions = new Map<string, AcpSession>();
    const on = (instanceId: string) => deps(sessions, { threadId: "thread-2", instanceId });
    expect(prepareAcpSpawn(on("engine-a")).spawnWhy).toBe("first");
    // the process exited (code 0) between two turns: dropped from the pool
    noteEngineExited("thread-2", 0);
    sessions.delete("thread-2");
    expect(prepareAcpSpawn(on("engine-a")).spawnWhy).toBe("exited:0");
    // killed by the system while it still sat in the pool
    noteEngineExited("thread-2", null, "SIGKILL");
    sessions.get("thread-2")!.dead = true;
    expect(prepareAcpSpawn(on("engine-a")).spawnWhy).toBe("exited:sigkill");
    // another engine of this server takes the conversation: its pool has none
    expect(prepareAcpSpawn({ ...on("engine-b"), sessions: new Map() }).spawnWhy).toBe("instance");
  });
});
