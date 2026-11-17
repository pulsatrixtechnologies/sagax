import { describe, expect, it } from "vitest";
import { routeMissingOnServer } from "./server-route";

const refusal = (status: number, body: Record<string, unknown>) =>
  Object.assign(new Error(String(body.error ?? "")), { status, body });

describe("routeMissingOnServer", () => {
  it("reads an older server's admin-scope refusal as a route it does not have yet", () => {
    expect(routeMissingOnServer(refusal(403, { error: "forbidden: this session lacks the admin scope" }))).toBe(true);
  });

  // #4471: a server that classes every route words the refusal by code
  it("reads the gate's admin_route refusal the same way", () => {
    expect(routeMissingOnServer(refusal(403, { error: "Only an administrator can do this on this server.", code: "admin_route" }))).toBe(true);
  });

  // a handler's own admin_only refusal is a real answer, never "arrives with the update"
  it("keeps a handler's admin_only refusal a failure", () => {
    expect(routeMissingOnServer(refusal(403, { error: "Only an organization admin manages every page.", code: "admin_only" }))).toBe(false);
  });

  it("keeps any other refusal a failure", () => {
    expect(routeMissingOnServer(refusal(403, { error: "forbidden", code: "not_yours" }))).toBe(false);
  });
});
