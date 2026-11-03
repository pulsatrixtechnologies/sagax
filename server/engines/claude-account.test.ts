import { describe, expect, it } from "vitest";
import { claudeAccountLinked, soloClaudeAccountLinked, type SoloClaudeLinkCache } from "./claude-account.ts";

describe("claudeAccountLinked", () => {
  it("is own Claude login or own Anthropic key, never the organization key", () => {
    expect(claudeAccountLinked({})).toBe(false);
    expect(claudeAccountLinked({ orgKey: true })).toBe(false);
    expect(claudeAccountLinked({ signedIn: true })).toBe(true);
    expect(claudeAccountLinked({ loginMarker: true })).toBe(true);
    expect(claudeAccountLinked({ anthropicConfigured: true })).toBe(true);
    expect(claudeAccountLinked({ myKey: true })).toBe(true);
    expect(claudeAccountLinked({ signedIn: false, myKey: false, orgKey: true })).toBe(false);
  });
});

describe("soloClaudeAccountLinked", () => {
  const run = (cache: SoloClaudeLinkCache, overrides: Partial<Parameters<typeof soloClaudeAccountLinked>[0]> = {}) => {
    let probes = 0;
    let writes = 0;
    const probe = overrides.probe ?? (async () => { probes += 1; return true; });
    const writeMarker = overrides.writeMarker ?? (() => { writes += 1; });
    const linked = soloClaudeAccountLinked({
      loginMarker: false,
      anthropicConfigured: false,
      cache,
      probe,
      writeMarker,
      ...overrides,
    });
    return { linked, probes: () => probes, writes: () => writes };
  };

  it("does not probe when a marker or an own key is already there", async () => {
    const marked = run({ probe: null }, { loginMarker: true, probe: async () => { throw new Error("spawned"); } });
    expect(await marked.linked).toBe(true);
    const keyed = run({ probe: null }, { anthropicConfigured: true, probe: async () => { throw new Error("spawned"); } });
    expect(await keyed.linked).toBe(true);
  });

  it("probes once, writes the marker when signed in, and does not spawn again", async () => {
    const cache: SoloClaudeLinkCache = { probe: null };
    const first = run(cache);
    expect(await first.linked).toBe(true);
    expect(first.writes()).toBe(1);
    const second = run(cache, { probe: async () => { throw new Error("spawned"); }, writeMarker: () => { throw new Error("wrote"); } });
    expect(await second.linked).toBe(true);
    expect(first.probes()).toBe(1);
  });

  it("remembers a signed-out probe and a failed probe", async () => {
    const signedOut: SoloClaudeLinkCache = { probe: null };
    const quiet = run(signedOut, { probe: async () => false });
    expect(await quiet.linked).toBe(false);
    expect(quiet.writes()).toBe(0);
    const again = run(signedOut, { probe: async () => { throw new Error("spawned"); } });
    expect(await again.linked).toBe(false);
    const failed: SoloClaudeLinkCache = { probe: null };
    const broken = run(failed, { probe: async () => { throw new Error("cli"); } });
    expect(await broken.linked).toBe(false);
    expect(await run(failed, { probe: async () => true }).linked).toBe(false);
  });

  it("shares one probe across overlapping calls", async () => {
    const cache: SoloClaudeLinkCache = { probe: null };
    let probes = 0;
    const probe = async () => { probes += 1; return true; };
    const both = await Promise.all([
      soloClaudeAccountLinked({ loginMarker: false, anthropicConfigured: false, cache, probe, writeMarker: () => undefined }),
      soloClaudeAccountLinked({ loginMarker: false, anthropicConfigured: false, cache, probe, writeMarker: () => undefined }),
    ]);
    expect(both).toEqual([true, true]);
    expect(probes).toBe(1);
  });

  it("stays linked when the marker cannot be written", async () => {
    const cache: SoloClaudeLinkCache = { probe: null };
    const linked = await soloClaudeAccountLinked({
      loginMarker: false,
      anthropicConfigured: false,
      cache,
      probe: async () => true,
      writeMarker: () => { throw new Error("disk"); },
    });
    expect(linked).toBe(true);
  });
});
