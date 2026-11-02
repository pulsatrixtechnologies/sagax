import { describe, expect, it } from "vitest";
import { INVITE_TTL_MS } from "./org-directory.ts";
import { createOrg, issueInvite, memberListsAfterAccept } from "./org-record.ts";

const OWNER = "pr_00000000-0000-4000-8000-00000000000a";

describe("org record", () => {
  it("records the creator as the only owner on a server", () => {
    expect(createOrg({ name: "Example", ownerUserId: OWNER, host: { kind: "server", url: "https://server.example.com" } })).toEqual({
      name: "Example",
      ownerUserId: OWNER,
      host: { kind: "server", url: "https://server.example.com" },
    });
  });
  it("rejects a blank name", () => {
    expect(() => createOrg({ name: "  ", ownerUserId: OWNER, host: { kind: "server", url: "https://server.example.com" } })).toThrow(/name/);
  });
  it("issues a single-use invite that expires in 7 days", () => {
    expect(issueInvite({ email: "morgan@example.test", now: 50, token: "tok" }).expiresAt).toBe(50 + INVITE_TTL_MS);
  });
  it("returns an existing member without a second row", () => {
    expect(memberListsAfterAccept({ members: ["morgan@example.test"], email: "morgan@example.test" })).toEqual({
      members: ["morgan@example.test"],
      alreadyMember: true,
    });
  });
  it("requires a server address for a new organization", () => {
    expect(() => createOrg({ name: "Example", ownerUserId: OWNER, host: { kind: "this-computer" } })).toThrow(/server address/);
    expect(() => createOrg({ name: "Example", ownerUserId: OWNER, host: { kind: "server", url: "http://10.0.0.5:8799" } })).toThrow(/server address/);
    expect(createOrg({ name: "Example", ownerUserId: OWNER, host: { kind: "server", url: "http://localhost:8080" } }).host)
      .toEqual({ kind: "server", url: "http://localhost:8080" });
    expect(createOrg({ name: "Example", ownerUserId: OWNER, host: { kind: "server", url: "http://host.example-tailnet.ts.net:8799" } }).host)
      .toEqual({ kind: "server", url: "http://host.example-tailnet.ts.net:8799" });
  });
  it("refuses an owner that is not a principal", () => {
    for (const owner of ["owner@example.com", "local-owner", "", "pr_x"]) {
      expect(() => createOrg({ name: "Example", ownerUserId: owner, host: { kind: "server", url: "https://a.b" } })).toThrow(/principal/);
    }
  });
  it("keeps the principal id as given", () => {
    expect(createOrg({ name: "Example", ownerUserId: "pr_00000000-0000-4000-8000-000000000000", host: { kind: "server", url: "https://a.b" } }).ownerUserId)
      .toBe("pr_00000000-0000-4000-8000-000000000000");
  });
});
