// #4410: the reader that hands pi a person's Claude sign-in. It runs the
// real single-flight renewal (ensureClaudeSubscriptionFresh) against a fake
// login folder, so a renamed host member or a broken renew turns red here
// instead of quietly refusing the person's turn.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RenewInput, SubscriptionAccess } from "../cloud-agents/subscription-access.ts";
import { ensureClaudeSubscriptionFresh, resetClaudeSubscriptionRefreshForTests } from "../engines/claude-subscription-refresh.ts";
import { claudeSignInToken, grokSignInToken } from "./orgTurnAccess.ts";

const PRIMARY = "/fake/principals/p1/claude";

function fakeHost(options: { stored: SubscriptionAccess | null; renewTo?: SubscriptionAccess | null; cli?: boolean }) {
  let stored = options.stored;
  const calls = { loginDirs: [] as unknown[][], renews: [] as RenewInput[], ensured: [] as string[] };
  const read = async (dir: string) => (dir === PRIMARY ? stored : null);
  const host = {
    engineLogins: {
      loginDir: (...args: unknown[]) => {
        calls.loginDirs.push(args);
        return PRIMARY;
      },
    },
    subscriptionCli: (engine: string) => (options.cli === false || engine !== "claude-code" ? null : { cli: "claude", environment: {} }),
    // the real renewal, with the folder and the CLI faked
    ensureClaudeSubscriptionFresh: (input: Parameters<typeof ensureClaudeSubscriptionFresh>[0]) => {
      calls.ensured.push(input.loginDir);
      return ensureClaudeSubscriptionFresh({
        ...input,
        read,
        renew: async (renewInput) => {
          calls.renews.push(renewInput);
          if (options.renewTo !== undefined) stored = options.renewTo;
        },
      });
    },
    readSubscriptionAccess: async (engine: string, dir: string) => (engine === "claude-code" ? read(dir) : null),
  };
  return { host, calls };
}

const access = (accessToken: string, expiresAt: number | null): SubscriptionAccess => ({ provider: "anthropic", accessToken, expiresAt });

afterEach(() => resetClaudeSubscriptionRefreshForTests());

describe("claudeSignInToken (#4410)", () => {
  it("renews a token near its end through ensureClaudeSubscriptionFresh on the primary Claude folder", async () => {
    const { host, calls } = fakeHost({ stored: access("old-token", Date.now() + 5 * 60_000), renewTo: access("new-token", Date.now() + 3_600_000) });
    const signIn = await claudeSignInToken(host, "p1");
    expect(calls.loginDirs).toEqual([["p1", "claudeAgent", "primary"]]);
    expect(calls.ensured).toEqual([PRIMARY]);
    expect(calls.renews).toHaveLength(1);
    expect(calls.renews[0]).toMatchObject({ engine: "claude-code", cli: "claude", loginDir: PRIMARY });
    expect(signIn).toEqual({ accessToken: "new-token" });
  });

  it("returns null when the renewal fails", async () => {
    const { host, calls } = fakeHost({ stored: access("old-token", Date.now() - 1_000), renewTo: access("old-token", Date.now() - 1_000) });
    expect(await claudeSignInToken(host, "p1")).toBeNull();
    expect(calls.renews).toHaveLength(1);
  });

  it("returns null when the sign-in is gone after the renewal", async () => {
    const { host } = fakeHost({ stored: access("old-token", Date.now() - 1_000), renewTo: null });
    expect(await claudeSignInToken(host, "p1")).toBeNull();
  });

  it("returns null for a token ending within 60 s", async () => {
    // no CLI to renew with: the token is read as it is
    const { host, calls } = fakeHost({ stored: access("short-token", Date.now() + 30_000), cli: false });
    expect(await claudeSignInToken(host, "p1")).toBeNull();
    expect(calls.ensured).toEqual([]);
  });

  it("returns a fresh token, and only the access token, without renewing", async () => {
    const stored = { ...access("fresh-token", Date.now() + 3_600_000), refreshToken: "never-handed-over" } as SubscriptionAccess;
    const { host, calls } = fakeHost({ stored });
    const signIn = await claudeSignInToken(host, "p1");
    expect(signIn).toEqual({ accessToken: "fresh-token" });
    expect(Object.keys(signIn ?? {})).toEqual(["accessToken"]);
    expect(calls.ensured).toEqual([PRIMARY]);
    expect(calls.renews).toEqual([]);
  });

  it("returns null when the server keeps no sign-ins", async () => {
    const { host } = fakeHost({ stored: access("fresh-token", Date.now() + 3_600_000) });
    expect(await claudeSignInToken({ ...host, engineLogins: undefined }, "p1")).toBeNull();
  });

  it("the server's leaf host still exposes every member the reader calls", () => {
    // orgTurnAccess.ts is @ts-nocheck: a renamed member would only throw at
    // dispatch, where materializeEngineAccess turns it into a refused turn
    const source = readFileSync(join(import.meta.dirname, "..", "index.ts"), "utf8");
    for (const member of ["engineLogins", "subscriptionCli", "ensureClaudeSubscriptionFresh", "readSubscriptionAccess", "grokLiveAccessOf"]) {
      expect(source).toContain(`get ${member}() { return ${member}; }`);
    }
  });
});

describe("grokSignInToken (#4410 / #5525)", () => {
  it("returns only the access token of a live Grok sign-in", async () => {
    const asked: string[] = [];
    const host = {
      grokLiveAccessOf: async (principalId: string) => {
        asked.push(principalId);
        return { ok: true as const, accessToken: "fixture-grok-live-access", expiresAt: Date.now() + 3_600_000 };
      },
    };
    expect(await grokSignInToken(host, "p1")).toEqual({ accessToken: "fixture-grok-live-access" });
    expect(asked).toEqual(["p1"]);
  });

  it("returns null when the live path has no sign-in or refuses it", async () => {
    expect(await grokSignInToken({ grokLiveAccessOf: async () => ({ ok: false as const, error: "no_sign_in" as const }) }, "p1")).toBeNull();
    expect(await grokSignInToken({ grokLiveAccessOf: async () => ({ ok: false as const, error: "sign_in_refused" as const }) }, "p1")).toBeNull();
    expect(await grokSignInToken({}, "p1")).toBeNull();
  });
});
