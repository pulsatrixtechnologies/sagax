import { describe, expect, it } from "vitest";

import { externalRuntimeMayCall } from "./external-runtime-may-call.ts";

describe("externalRuntimeMayCall", () => {
  it("allows the peer-comms allow-list only", () => {
    expect(externalRuntimeMayCall("GET", "/api/internal/agents")).toBe(true);
    expect(externalRuntimeMayCall("GET", "/api/internal/delegations/d1")).toBe(true);
    expect(externalRuntimeMayCall("POST", "/api/internal/ask-bot")).toBe(true);
    expect(externalRuntimeMayCall("POST", "/api/internal/delegate-bot")).toBe(true);
    expect(externalRuntimeMayCall("POST", "/api/internal/create-bot")).toBe(false);
    expect(externalRuntimeMayCall("GET", "/api/internal/routines")).toBe(false);
  });
});
