import { describe, expect, it, beforeEach } from "vitest";

import { clearPaidKeyConfirmations, paidKeyIsConfirmed } from "../credentials/paid-key-confirm.ts";
import { createCredentialConfirmRoutes, CREDENTIAL_CONFIRM_PATH } from "./credential-confirm.ts";
import { confirmPaidKey } from "../credentials/paid-key-confirm.ts";

function call(body: unknown) {
  const handler = createCredentialConfirmRoutes({ rememberPaidKey: confirmPaidKey });
  let status = 0;
  let payload: unknown;
  const res = { setHeader() { return res; } };
  return handler({
    req: {},
    res,
    path: CREDENTIAL_CONFIRM_PATH,
    method: "POST",
    auth: { kind: "loopback", scopes: ["client"] },
    json(_res: unknown, code: number, value: unknown) { status = code; payload = value; },
    readBody: async () => body,
  } as never).then(() => ({ status, payload }));
}

describe("POST /api/me/credential-confirm (#5180)", () => {
  beforeEach(() => clearPaidKeyConfirmations());

  it("remembers a conversation the person confirmed, and rejects a bad id", async () => {
    expect(await call({ threadId: "thread_ada" })).toEqual({ status: 200, payload: { ok: true, threadId: "thread_ada" } });
    expect(paidKeyIsConfirmed("thread_ada")).toBe(true);
    expect((await call({ threadId: "has space" })).status).toBe(400);
    expect(paidKeyIsConfirmed("has space")).toBe(false);
    expect(JSON.stringify(await call({ threadId: "thread_ada" }))).not.toMatch(/sk-|xai-/);
  });
});
