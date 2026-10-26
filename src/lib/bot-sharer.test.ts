import { describe, expect, it } from "vitest";

import { botSharer } from "./bot-sharer";
import type { OrgDirectoryPerson } from "./perspicax-org";

const person = (principalId: string, name: string, avatarUrl?: string): OrgDirectoryPerson => ({ principalId, name, login: name.toLowerCase(), role: "member", disabled: false, ...(avatarUrl ? { avatarUrl } : {}) });
const people = new Map([["pr_ada", person("pr_ada", "Ada Lovelace", "/api/people/pr_ada/avatar")], ["pr_me", person("pr_me", "Me Myself")]]);

describe("botSharer", () => {
  it("is the person who owns a bot shared with the viewer, from the directory", () => {
    const sharer = botSharer({ ownerUserId: "PR_Ada" }, "pr_me", people);
    expect(sharer).toMatchObject({ principalId: "pr_ada", name: "Ada Lovelace", initials: "AL" });
    expect(sharer?.avatarUrl).toBeTruthy();
  });

  it("is nobody for the viewer's own bot, a local bot or a bot without an owner", () => {
    expect(botSharer({ ownerUserId: "pr_me" }, "PR_ME", people)).toBeNull();
    expect(botSharer({ ownerUserId: "local-owner" }, "pr_me", people)).toBeNull();
    expect(botSharer({}, "pr_me", people)).toBeNull();
  });

  it("is nobody when the directory does not expose the owner (privacy)", () => {
    expect(botSharer({ ownerUserId: "pr_stranger" }, "pr_me", people)).toBeNull();
    expect(botSharer({ ownerUserId: "pr_ada" }, "pr_me", new Map())).toBeNull();
  });
});
