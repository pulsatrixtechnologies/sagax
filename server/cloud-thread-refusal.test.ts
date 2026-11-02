import { describe, expect, it } from "vitest";

import { cloudGuestSendRefusal, cloudThreadRefusal } from "./cloud-thread-refusal.ts";
import type { RequestAuth } from "./request-auth.ts";

const session = {
  kind: "session",
  session: { id: "s1", label: "Ada", scopes: ["client"] as const, createdAt: 0, lastSeenAt: 0, expiresAt: 0, tokenHash: "a".repeat(64) },
  via: "cookie",
  scopes: ["client"],
} as RequestAuth;

describe("cloud-thread-refusal", () => {
  it("always allows: personal Cloud home is gone", () => {
    expect(cloudThreadRefusal(session, "t1")).toBeNull();
    expect(cloudGuestSendRefusal(session, "t1")).toBeNull();
    expect(cloudThreadRefusal({ kind: "loopback", scopes: ["admin"] }, "t2")).toBeNull();
    expect(cloudGuestSendRefusal({ kind: "loopback", scopes: ["admin"] }, "t2")).toBeNull();
  });
});
