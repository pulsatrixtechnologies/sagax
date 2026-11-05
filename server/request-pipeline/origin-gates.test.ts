import { describe, expect, it, vi } from "vitest";
import { createOriginGates } from "./origin-gates.ts";

describe("createOriginGates", () => {
  it("returns a function", () => {
    const originGates = createOriginGates(() => ({
      IDENTITY: { kind: "personal" },
      json: vi.fn(),
      PAGES_ORIGIN: null,
      handlePagesOriginRequest: () => false,
      publishedPageOptions: () => ({}),
      orgAdmin: async () => false,
      orgMember: async () => false,
      inboundMail: async () => false,
      inboundTelephony: async () => false,
      orgLink: async () => false,
      securityKeyCeremonies: async () => false,
      isInterimSignInRoute: () => false,
      HOSTED_WORKSPACE: false,
      managedPolicy: { remoteAccessRefusal: () => null },
      PUBLIC_INVITE_PATH: /^$/,
    } as any));
    expect(typeof originGates).toBe("function");
  });
});
