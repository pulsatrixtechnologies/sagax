import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { legacyPersonKey, personKey, speakerFor } from "./request-speaker.ts";
import type { RequestAuth } from "./request-auth.ts";

describe("request-speaker", () => {
  it("uses the session principal id when present", () => {
    expect(personKey({ id: "s1", email: "ada@example.test", principalId: "pr_ada" })).toBe("pr_ada");
  });

  it("hashes email or session id when there is no principal", () => {
    const byEmail = legacyPersonKey({ id: "s1", email: "Ada@Example.TEST" });
    const expected = `p_${createHash("sha256").update("email:ada@example.test").digest("base64url").slice(0, 22)}`;
    expect(byEmail).toBe(expected);
    expect(personKey({ id: "s1", email: "Ada@Example.TEST" })).toBe(byEmail);

    const bySession = legacyPersonKey({ id: "s9" });
    expect(bySession).toBe(`p_${createHash("sha256").update("session:s9").digest("base64url").slice(0, 22)}`);
    expect(personKey({ id: "s9" })).toBe(bySession);
  });

  it("maps session auth to a person speaker and loopback to operator or person", () => {
    const session = {
      kind: "session",
      session: { id: "s1", principalId: "pr_ada", label: "Ada", scopes: ["client"] as const, createdAt: 0, lastSeenAt: 0, expiresAt: 0, tokenHash: "a".repeat(64) },
      via: "cookie",
      scopes: ["client"],
    } as RequestAuth;
    expect(speakerFor(session)).toEqual({ origin: "person", principalId: "pr_ada" });

    const owner: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
    expect(speakerFor(owner)).toEqual({ origin: "operator" });

    const service: RequestAuth = { kind: "loopback", scopes: ["client"], trust: "service" };
    expect(speakerFor(service)).toEqual({ origin: "person" });
  });
});
