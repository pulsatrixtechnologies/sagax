// Which people a room draft tags (src/lib/person-mentions.ts): the rule the
// server notifies by (server/rooms/room-mentions.ts).
import { describe, expect, it } from "vitest";

import type { OrgDirectoryPerson } from "./perspicax-org";
import { roomAllowsMentionAll, roomMentionedPeople, roomMentionPeople } from "./person-mentions";

const person = (principalId: string, name: string, login = name.toLowerCase()): [string, OrgDirectoryPerson] =>
  [principalId, { principalId, name, login, role: "member", disabled: false }];
const directory = new Map([
  person("pr_alice", "Alice"),
  person("pr_ann", "Ann"),
  person("pr_annlee", "Ann Lee"),
  person("pr_bob", "Bob Tremblay"),
  person("pr_zoe", "Zoé Côté"),
  person("pr_all", "All"),
]);
const room = { humanIds: ["pr_alice", "pr_ann", "pr_annlee", "pr_bob", "pr_zoe", "pr_all", "pr_unknown"] };
const tagged = (text: string, extra: Partial<typeof room & { mentionAll: boolean; dm: boolean; peopleDm: boolean }> = {}) =>
  roomMentionedPeople(text, { ...room, ...extra }, directory, "pr_alice");

describe("person mentions in a room", () => {
  it("matches display names, case-insensitively, the longest name first", () => {
    expect(tagged("@bob tremblay can you check? cc @Ann Lee and @Zoé Côté")).toEqual(["pr_bob", "pr_annlee", "pr_zoe"]);
    expect(tagged("@Ann, then @Ann Lee, then @ann again")).toEqual(["pr_ann", "pr_annlee"]);
  });

  it("ignores emails, partial names, longer words and the viewer", () => {
    expect(tagged("mail bob@Bob Tremblay.test, @Bob, @Annette, @Alice")).toEqual([]);
  });

  it("excludes @all unless the room allows it", () => {
    expect(tagged("@all standup in 5")).toEqual([]);
    expect(tagged("@all standup in 5", { mentionAll: true })).toEqual(["pr_ann", "pr_annlee", "pr_bob", "pr_zoe", "pr_all"]);
    // a name that starts with "all" is not @all
    expect(tagged("@allons-y", { mentionAll: true })).toEqual([]);
    expect(roomAllowsMentionAll({ mentionAll: true, dm: true })).toBe(false);
    expect(roomAllowsMentionAll({ mentionAll: true, peopleDm: true })).toBe(false);
    expect(roomAllowsMentionAll({})).toBe(false);
  });

  it("offers everyone in the room but the viewer, by their display name", () => {
    expect(roomMentionPeople(room, directory, "PR_ALICE").map((entry) => entry.name)).toEqual(["Ann", "Ann Lee", "Bob Tremblay", "Zoé Côté", "All"]);
    expect(roomMentionPeople({ ...room, peopleDm: true }, directory, "pr_alice")).toEqual([]);
    expect(tagged("@Bob Tremblay", { dm: true })).toEqual([]);
  });
});
