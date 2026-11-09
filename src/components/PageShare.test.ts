// The Share popover (src/components/PageShare.tsx): a page not shared yet is
// shared only by the person's own gesture, with the access they chose; a
// shared one changes in place; invites are whole lists, without duplicates.
import { describe, expect, it } from "vitest";

import { sharePlan, teamCandidates, withInvite } from "./PageShare";
import { showBotLibraryChoice } from "@/lib/page-share-plan";

const now = 1_000_000;
const draft = { status: "draft" as const, access: "private" as const, expiresAt: null, currentVersion: null };
const live = { status: "published" as const, access: "org" as const, expiresAt: now + 5_000, currentVersion: 2 };

describe("what one gesture sends", () => {
  it("a page not shared yet: choosing who can see it, adding someone or copying the link publishes the version on screen", () => {
    expect(sharePlan(draft, 3, { kind: "access", access: "org" }, now)).toEqual([{ method: "POST", path: "/publish", body: { version: 3, access: "org", expiresAt: null } }]);
    expect(sharePlan(draft, 3, { kind: "invites", invites: { people: ["pr_b"], teams: [] } }, now)).toEqual([
      { method: "POST", path: "/invite", body: { people: ["pr_b"], teams: [] } },
      { method: "POST", path: "/publish", body: { version: 3, access: "private", expiresAt: null } },
    ]);
    expect(sharePlan(draft, 3, { kind: "link" }, now)).toEqual([{ method: "POST", path: "/publish", body: { version: 3, access: "private", expiresAt: null } }]);
    // nothing to stop, no expiry to change
    expect(sharePlan(draft, 3, { kind: "stop" }, now)).toEqual([]);
    expect(sharePlan(draft, 3, { kind: "expiry", hours: 24 }, now)).toEqual([]);
  });

  it("a shared page changes in place and is never published again by a copy", () => {
    expect(sharePlan(live, 2, { kind: "access", access: "link" }, now)).toEqual([{ method: "PATCH", path: "", body: { access: "link" } }]);
    expect(sharePlan(live, 2, { kind: "access", access: "org" }, now)).toEqual([]);
    expect(sharePlan(live, 2, { kind: "link" }, now)).toEqual([]);
    expect(sharePlan(live, 2, { kind: "invites", invites: { people: [], teams: ["t1"] } }, now)).toEqual([{ method: "POST", path: "/invite", body: { people: [], teams: ["t1"] } }]);
    expect(sharePlan(live, 2, { kind: "stop" }, now)).toEqual([{ method: "POST", path: "/revoke", body: {} }]);
    expect(sharePlan(live, 2, { kind: "expiry", hours: 24 }, now)).toEqual([{ method: "PATCH", path: "", body: { expiresAt: now + 24 * 3_600_000 } }]);
  });

  it("#3128: switching between personal and shared in the Library is one PATCH, publishing a draft first", () => {
    expect(sharePlan(live, 2, { kind: "bot", shared: true }, now)).toEqual([{ method: "PATCH", path: "", body: { botShared: true } }]);
    expect(sharePlan(live, 2, { kind: "bot", shared: false }, now)).toEqual([{ method: "PATCH", path: "", body: { botShared: false } }]);
    expect(sharePlan(draft, 3, { kind: "bot", shared: true }, now)).toEqual([
      { method: "POST", path: "/publish", body: { version: 3, access: "private", expiresAt: null } },
      { method: "PATCH", path: "", body: { botShared: true } },
    ]);
  });

  it("a newer version on screen is shared only by its own button, keeping the access and a future expiry", () => {
    expect(sharePlan(live, 2, { kind: "version" }, now)).toEqual([]);
    expect(sharePlan(live, 4, { kind: "version" }, now)).toEqual([{ method: "POST", path: "/publish", body: { version: 4, access: "org", expiresAt: now + 5_000 } }]);
    expect(sharePlan({ ...live, expiresAt: now - 1 }, 4, { kind: "version" }, now)[0]!.body.expiresAt).toBeNull();
  });
});

describe("the invite lists", () => {
  it("adds once, removes case-insensitively", () => {
    const one = withInvite(undefined, { kind: "person", id: "pr_b" }, true);
    expect(one).toEqual({ people: ["pr_b"], teams: [] });
    expect(withInvite(one, { kind: "person", id: "PR_B" }, true)).toEqual({ people: ["PR_B"], teams: [] });
    expect(withInvite(one, { kind: "person", id: "PR_B" }, false)).toEqual({ people: [], teams: [] });
    expect(withInvite(one, { kind: "team", id: "t1" }, true)).toEqual({ people: ["pr_b"], teams: ["t1"] });
  });

  it("offers the teams whose name matches, never one already invited", () => {
    const teams = [{ id: "t1", name: "Support", managers: [], members: ["a"] }, { id: "t2", name: "Sales support", managers: [], members: [] }, { id: "t3", name: "Finance", managers: [], members: [] }];
    expect(teamCandidates(teams, ["t1"], "supp").map((team) => team.id)).toEqual(["t2"]);
    expect(teamCandidates(teams, [], "").length).toBe(3);
  });
});

describe("#3194: the In the bot's Library choice", () => {
  const personal = { botShared: undefined };
  it("is hidden for a solo bot, on a solo server or on an organization server", () => {
    expect(showBotLibraryChoice({ page: personal, org: false, viewerId: "pr_a", bot: { ownerUserId: "pr_a" } })).toBe(false);
    expect(showBotLibraryChoice({ page: personal, org: true, viewerId: "pr_a", bot: { ownerUserId: "pr_a", grants: [] } })).toBe(false);
    expect(showBotLibraryChoice({ page: personal, org: true, viewerId: "pr_a", bot: undefined })).toBe(false);
  });
  it("shows for a shared bot, the owner's or someone else's, and for a page already shared", () => {
    expect(showBotLibraryChoice({ page: personal, org: true, viewerId: "pr_a", bot: { ownerUserId: "pr_a", grants: [{}] } })).toBe(true);
    expect(showBotLibraryChoice({ page: personal, org: true, viewerId: "pr_b", bot: { ownerUserId: "pr_a" } })).toBe(true);
    expect(showBotLibraryChoice({ page: { botShared: true }, org: false, viewerId: "pr_a", bot: undefined })).toBe(true);
  });
});
