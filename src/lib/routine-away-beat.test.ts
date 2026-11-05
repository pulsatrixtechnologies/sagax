import { describe, expect, it, vi } from "vitest";
import { isOrganizationDescriptor, startRoutineAwayLoop, ROUTINE_AWAY_BEAT_PATH, type RoutineAwayBeatDeps } from "./routine-away-beat";

function deps(over: Partial<RoutineAwayBeatDeps> = {}) {
  const post = vi.fn(async () => ({ ok: true, status: 200 }));
  const setInterval = vi.fn(() => 1);
  return { post, setInterval, value: { post, now: () => 1_000, setInterval, clearInterval: vi.fn(), ...over } as RoutineAwayBeatDeps };
}

describe("Only when I'm here beat (0.8.46: none on an organization server)", () => {
  it("recognizes an organization server by its Perspicax identity", () => {
    expect(isOrganizationDescriptor({ identity: { kind: "perspicax", protocol: "oidc", issuer: "https://id.example.test", loginPath: "/auth/oidc/start" } })).toBe(true);
    for (const descriptor of [{}, { identity: null }, { identity: { kind: "local" } }, null, "x"]) expect(isOrganizationDescriptor(descriptor)).toBe(false);
  });
  it("never posts the beat on an organization server", async () => {
    const d = deps();
    expect(await startRoutineAwayLoop({ ...d.value, organization: async () => true })).toBeNull();
    expect(d.post).not.toHaveBeenCalled();
    expect(d.setInterval).not.toHaveBeenCalled();
  });
  it("beats every minute on a solo server", async () => {
    const d = deps();
    expect(await startRoutineAwayLoop({ ...d.value, organization: async () => false })).not.toBeNull();
    expect(d.post).toHaveBeenCalledWith(ROUTINE_AWAY_BEAT_PATH, { idleMs: 0, systemIdle: "unknown" });
    expect(d.setInterval).toHaveBeenCalledWith(expect.any(Function), 60_000);
  });
  it("still beats when the descriptor cannot be read, and stops on an older server's 404", async () => {
    const d = deps({ post: vi.fn(async () => ({ ok: false, status: 404 })) });
    expect(await startRoutineAwayLoop({ ...d.value, organization: async () => { throw new Error("offline"); } })).toBeNull();
    expect(d.value.post).toHaveBeenCalledOnce();
    expect(d.setInterval).not.toHaveBeenCalled();
  });
});
