// #4394: ordinary turns on a hosted server started an engine every time
// (path=spawn) and nothing said why: the reason now rides the turn's latency
// line (spawnWhy). Here the session selection alone, with a fake process.
import { afterEach, describe, expect, it, vi } from "vitest";
import { warmResources } from "../../resources/warm-resources.ts";
import { prepareAcpSpawn, type AcpSpawnDeps } from "./turn-prepare-spawn.ts";
import { noteEngineClosed, takeEngineClosed } from "./turn-latency.ts";
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
    expect(first.spawnWhy).toBe("none");
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
});
