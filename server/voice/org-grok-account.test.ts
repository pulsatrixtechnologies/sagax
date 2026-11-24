import { describe, expect, it, vi } from "vitest";

import { orgGrokAccess, type OrgGrokAccountDeps } from "./org-grok-account.ts";

// made-up values, never a real credential
const ACCESS = `fake-org-grok-access-${"5".repeat(24)}`;
const EXPIRES = Date.parse("2026-11-23T20:00:00.000Z");

function deps(patch: Partial<OrgGrokAccountDeps> = {}): OrgGrokAccountDeps {
  return {
    designated: () => "sub-ada",
    person: (sub) => (sub === "sub-ada" ? { principalId: "pr_ada", active: true } : null),
    accountKind: () => "team",
    grokSignIn: async () => ({ ok: true, accessToken: ACCESS, expiresAt: EXPIRES }),
    ...patch,
  };
}

describe("the organization's Grok account (#5200)", () => {
  it("is the team sign-in of the person the organization named, read through that person's own renewal", async () => {
    const grokSignIn = vi.fn(async () => ({ ok: true as const, accessToken: ACCESS, expiresAt: EXPIRES }));
    expect(await orgGrokAccess(deps({ grokSignIn }))).toEqual({ ok: true, accessToken: ACCESS, expiresAt: EXPIRES, principalId: "pr_ada" });
    expect(grokSignIn).toHaveBeenCalledWith("pr_ada");
  });

  it("says there is none when the organization named nobody, without reading any sign-in", async () => {
    const grokSignIn = vi.fn(async () => ({ ok: true as const, accessToken: ACCESS, expiresAt: EXPIRES }));
    expect(await orgGrokAccess(deps({ designated: () => undefined, grokSignIn }))).toEqual({ ok: false, error: "no_org_account" });
    expect(await orgGrokAccess(deps({ designated: () => "  ", grokSignIn }))).toEqual({ ok: false, error: "no_org_account" });
    expect(grokSignIn).not.toHaveBeenCalled();
  });

  it("judges a person about to be named by the same rules, before the organization names them", async () => {
    const none = deps({ designated: () => undefined });
    expect(await orgGrokAccess(none, "sub-ada")).toEqual({ ok: true, accessToken: ACCESS, expiresAt: EXPIRES, principalId: "pr_ada" });
    expect(await orgGrokAccess(none, "sub-ghost")).toEqual({ ok: false, error: "unknown_person" });
    expect(await orgGrokAccess(deps({ designated: () => undefined, accountKind: () => "personal" }), "sub-ada")).toEqual({ ok: false, error: "not_team_account" });
  });

  it("never serves a personal Grok account as the organization's: only a team sign-in", async () => {
    const grokSignIn = vi.fn(async () => ({ ok: true as const, accessToken: ACCESS, expiresAt: EXPIRES }));
    expect(await orgGrokAccess(deps({ accountKind: () => "personal", grokSignIn }))).toEqual({ ok: false, error: "not_team_account" });
    expect(await orgGrokAccess(deps({ accountKind: () => "unknown", grokSignIn }))).toEqual({ ok: false, error: "not_team_account" });
    expect(grokSignIn).not.toHaveBeenCalled();
  });

  it("answers a stable code for an unknown or inactive person, no sign-in, and a refused one", async () => {
    expect(await orgGrokAccess(deps({ designated: () => "sub-ghost" }))).toEqual({ ok: false, error: "unknown_person" });
    expect(await orgGrokAccess(deps({ person: () => ({ principalId: "pr_ada", active: false }) }))).toEqual({ ok: false, error: "user_inactive" });
    expect(await orgGrokAccess(deps({ accountKind: () => null }))).toEqual({ ok: false, error: "no_sign_in" });
    expect(await orgGrokAccess(deps({ grokSignIn: async () => ({ ok: false, error: "no_sign_in" }) }))).toEqual({ ok: false, error: "no_sign_in" });
    expect(await orgGrokAccess(deps({ grokSignIn: async () => ({ ok: false, error: "sign_in_refused" }) }))).toEqual({ ok: false, error: "sign_in_refused" });
    expect(await orgGrokAccess(deps({ grokSignIn: async () => { throw new Error(`boom ${ACCESS}`); } }))).toEqual({ ok: false, error: "sign_in_refused" });
  });
});
