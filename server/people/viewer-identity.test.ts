import { describe, expect, it } from "vitest";

import { configForViewer, displayNameFromEmail, personAvatarUrl, personDisplayName, sessionIsOperator, type ViewerIdentity } from "./viewer-identity.ts";

const LOCAL = "pr_00000000-0000-4000-8000-000000000001";
const ZARA = "pr_00000000-0000-4000-8000-000000000002";

describe("viewer identity", () => {
  it("names a person by their email's local part", () => {
    expect(displayNameFromEmail("zara.q@example.test")).toBe("zara.q");
    expect(displayNameFromEmail("")).toBe("");
    expect(displayNameFromEmail(undefined)).toBe("");
  });

  it("treats the operator's principal, email and paired devices as the operator, and anyone else as themselves", () => {
    const base = { localPrincipalId: LOCAL, operatorEmail: "owner@example.com", admin: false, orgExists: true };
    expect(sessionIsOperator({ ...base, principalId: LOCAL })).toBe(true);
    expect(sessionIsOperator({ ...base, principalId: ZARA, admin: true })).toBe(false);
    expect(sessionIsOperator({ ...base, email: "OWNER@example.com" })).toBe(true);
    expect(sessionIsOperator({ ...base, email: "zara@example.test" })).toBe(false);
    // devices paired before principals
    expect(sessionIsOperator({ ...base, admin: true })).toBe(true);
    expect(sessionIsOperator({ ...base })).toBe(false);
    expect(sessionIsOperator({ ...base, orgExists: false })).toBe(true);
  });

  it("gives a member their own profile and keeps the operator's for the operator", () => {
    const status = { profile: { name: "Owner", email: "owner@example.com", aboutMe: "private", avatarUrl: "/api/profile/avatar.png" }, other: 1 };
    const member: ViewerIdentity = { operator: false, principalId: ZARA, email: "zara@example.test", name: "zara", role: "member", canCreateBots: true, operatorName: "Owner" };
    expect(configForViewer(status, member)).toEqual({ ...status, profile: { name: "zara", email: "zara@example.test", aboutMe: "", avatarUrl: "" }, viewer: member });
    const operator: ViewerIdentity = { operator: true, principalId: LOCAL, email: "owner@example.com", name: "Owner", role: "owner", canCreateBots: true };
    expect(configForViewer(status, operator)).toEqual({ ...status, viewer: operator });
    expect(configForViewer(status, null)).toBe(status);
  });
});

describe("how a person reads on an organization server", () => {
  it("is their Perspicax display name, else their address, else their login", () => {
    expect(personDisplayName({ name: "Alex Martin", login: "amartin", email: "amartin@example.test" })).toBe("Alex Martin");
    // the directory sends the login as the name when there is no display name
    expect(personDisplayName({ name: "amartin", login: "amartin", email: "owner@example.test" })).toBe("owner");
    expect(personDisplayName({ login: "amartin", email: "owner@example.test" })).toBe("owner");
    expect(personDisplayName({ login: "amartin" })).toBe("amartin");
    expect(personDisplayName({ name: "amartin", login: "amartin" })).toBe("amartin");
    expect(personDisplayName(null)).toBe("");
  });

  it("has an avatar URL only with a version and a Perspicax subject", () => {
    const subject = { iss: "https://px.example.test", sub: "S" };
    expect(personAvatarUrl({ id: ZARA, subject, avatar: "a1b2" })).toBe(`/api/people/${ZARA}/avatar?v=a1b2`);
    expect(personAvatarUrl({ id: ZARA, subject })).toBeUndefined();
    expect(personAvatarUrl({ id: ZARA, avatar: "a1b2" })).toBeUndefined();
  });

  it("puts the viewer's avatar in the profile they see", () => {
    const status = { profile: { name: "Op", email: "op@example.test", aboutMe: "x", avatarUrl: "data:op" } };
    const viewer: ViewerIdentity = { operator: false, principalId: ZARA, email: "z@example.test", name: "Zara", role: "member", canCreateBots: true, avatarUrl: `/api/people/${ZARA}/avatar?v=1` };
    expect(configForViewer(status, viewer).profile).toEqual({ name: "Zara", email: "z@example.test", aboutMe: "", avatarUrl: `/api/people/${ZARA}/avatar?v=1` });
    expect(configForViewer(status, { ...viewer, avatarUrl: undefined }).profile.avatarUrl).toBe("");
  });
});
