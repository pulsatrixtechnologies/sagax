// A conversation with a person has threads like a bot (server/people/people-dms.ts).
// In the client state: a live frame names the conversation's default thread,
// so the thread this person has open stays open; reading reads the open
// thread only; organizing a thread shows at once; the sidebar line says
// "You:" only for the viewer's own message.
import { describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { groupPreview } from "@/components/Sidebar";
import { personThreadTitle } from "@/lib/person-threads";
import { initialState, peopleDmReadTarget, personThreadKept, reducer, type AppState, type Group } from "./store";

const person: Group = {
  id: "dm", threadId: "budget", name: "Alice, Bob", memberIds: [], humanIds: ["pr_alice", "pr_bob"], peopleDm: true,
  defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: 1,
  messages: [{ id: "m1", role: "user", kind: "text", text: "numbers", at: 2 }],
  tasks: [
    { threadId: "general", title: "General", general: true, createdAt: 1 },
    { threadId: "budget", title: "Budget", createdAt: 2 },
  ],
};
const withPerson = (group: Group = person): AppState => ({ ...initialState, groups: [group] });

describe("the open thread of a conversation with a person", () => {
  it("a live frame (the default thread, no transcript) keeps the open thread", () => {
    const next = reducer(withPerson(), { type: "groupPatched", group: { id: "dm", threadId: "general", peopleDm: true, unread: true, tasks: person.tasks } });
    expect(next.groups[0]!.threadId).toBe("budget");
    expect(next.groups[0]!.messages.map((message) => message.id)).toEqual(["m1"]);
    expect(next.groups[0]!.unread).toBe(true);
  });

  it("an answer with a transcript (switch, create, fresh load) opens its thread", () => {
    const next = reducer(withPerson(), { type: "groupPatched", group: { id: "dm", threadId: "general", peopleDm: true, messages: [] } });
    expect(next.groups[0]!.threadId).toBe("general");
  });

  it("a frame that no longer lists the open thread (deleted) opens the default one", () => {
    expect(personThreadKept(person, { threadId: "general", tasks: [person.tasks![0]!] })).toBe(false);
    expect(personThreadKept({ ...person, peopleDm: false }, { threadId: "general" })).toBe(false);
  });

  it("reading means the open thread, or the whole conversation when only it is marked unread, never a sibling", () => {
    expect(peopleDmReadTarget({ threadId: "budget", unread: true, tasks: [{ threadId: "budget", title: "B", createdAt: 1, unread: true }] })).toEqual({ threadId: "budget" });
    expect(peopleDmReadTarget({ threadId: "general", unread: true, tasks: [{ threadId: "general", title: "G", createdAt: 1, unread: false }, { threadId: "budget", title: "B", createdAt: 1, unread: true }] })).toBeNull();
    expect(peopleDmReadTarget({ threadId: "general", unread: true, tasks: [{ threadId: "general", title: "G", createdAt: 1 }] })).toEqual({});
    expect(peopleDmReadTarget({ threadId: "general", unread: false, tasks: [] })).toBeNull();
  });

  it("archive, snooze, pin and folder show at once; null clears", () => {
    let state = reducer(withPerson(), { type: "updateGroupTask", groupId: "dm", threadId: "budget", patch: { archivedAt: 9, snoozedUntil: 0, pinned: true, projectId: "f1" } });
    expect(state.groups[0]!.tasks![1]).toMatchObject({ archivedAt: 9, snoozedUntil: 0, pinned: true, projectId: "f1" });
    state = reducer(state, { type: "updateGroupTask", groupId: "dm", threadId: "budget", patch: { archivedAt: null, snoozedUntil: null, pinned: false, projectId: null } });
    expect(state.groups[0]!.tasks![1]).toEqual({ threadId: "budget", title: "Budget", createdAt: 2 });
  });

  it("the migrated General thread reads in the person's language until renamed", () => {
    setLocale("fr");
    expect(personThreadTitle({ title: "General", general: true })).toBe("Général");
    expect(personThreadTitle({ title: "Lunch", general: true })).toBe("Lunch");
    expect(personThreadTitle({ title: "General" })).toBe("General");
    setLocale("en");
  });
});

describe("sidebar preview of a conversation with a person", () => {
  const config = { viewer: { principalId: "pr_alice" } } as Parameters<typeof groupPreview>[2];
  const line = (sender: { id: string; name: string } | undefined): Group => ({
    ...person, messages: [{ id: "m", role: "user", kind: "text", text: "see you at noon", at: 1, ...(sender ? { sender } : {}) }],
  });

  it("a received message reads as the message, never \"You:\"", () => {
    expect(groupPreview(line({ id: "pr_bob", name: "Bob" }), [], config, [])).toBe("see you at noon");
  });

  it("the viewer's own message reads \"You:\"", () => {
    expect(groupPreview(line({ id: "PR_ALICE", name: "Alice" }), [], config, [])).toBe("You: see you at noon");
  });

  it("the direct message the viewer is sending reads \"You:\" before the server's copy lands", () => {
    const member = { viewer: { principalId: "pr_alice", operator: false, operatorName: "Owner" } } as Parameters<typeof groupPreview>[2];
    const sending: Group = { ...person, messages: [{ id: "optimistic-s1", sendId: "s1", role: "user", kind: "text", text: "see you at noon", at: 1 }] };
    expect(groupPreview(sending, [], member, [])).toBe("You: see you at noon");
    // the server's copy carries the sender: still the viewer's
    expect(groupPreview(line({ id: "pr_alice", name: "Alice" }), [], member, [])).toBe("You: see you at noon");
  });

  it("in a room, another person's message names them", () => {
    expect(groupPreview({ ...line({ id: "pr_bob", name: "Bob" }), peopleDm: false }, [], config, [])).toBe("Bob: see you at noon");
  });
});
