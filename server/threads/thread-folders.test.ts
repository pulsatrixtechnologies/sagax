// The request rules of thread folders and thread organization, shared by a
// bot's routes and a person conversation's (server/threads/thread-folders.ts).
import { describe, expect, it } from "vitest";

import { parseFolderBody, parseFolderOrder, parseThreadOrganization } from "./thread-folders.ts";

describe("thread folder requests", () => {
  it("a create needs a name; an edit takes a name, an emoji or null", () => {
    expect(parseFolderBody({ name: "  Ops  ", emoji: "💼" }, true)).toEqual({ ok: true, patch: { name: "Ops", emoji: "💼" } });
    expect(parseFolderBody({ emoji: "💼" }, true)).toMatchObject({ ok: false });
    expect(parseFolderBody({ emoji: null }, false)).toEqual({ ok: true, patch: { emoji: null } });
    expect(parseFolderBody({ name: "x".repeat(81) }, false)).toMatchObject({ ok: false });
    expect(parseFolderBody({ emoji: "ab" }, false)).toMatchObject({ ok: false });
    expect(parseFolderBody({ name: "Ops", cwd: "/tmp" }, true)).toEqual({ ok: false, error: "unsupported folder setting" });
    expect(parseFolderBody([], true)).toMatchObject({ ok: false });
  });

  it("an order is a list of folder ids and nothing else", () => {
    expect(parseFolderOrder({ projectIds: ["a", "b"] })).toEqual({ ok: true, projectIds: ["a", "b"] });
    expect(parseFolderOrder({ projectIds: ["a", 2] })).toMatchObject({ ok: false });
    expect(parseFolderOrder({ projectIds: ["a"], extra: 1 })).toMatchObject({ ok: false });
  });

  it("archive, snooze, pin and folder: present fields only, null clears", () => {
    const owns = (id: string) => id === "f1";
    expect(parseThreadOrganization({ title: "kept elsewhere" }, owns)).toEqual({ ok: true, patch: {} });
    const set = parseThreadOrganization({ archivedAt: 5, snoozedUntil: 0, pinned: true, projectId: "f1" }, owns);
    expect(set).toEqual({ ok: true, patch: { archivedAt: 5, snoozedUntil: 0, pinned: true, projectId: "f1" } });
    const cleared = parseThreadOrganization({ archivedAt: null, snoozedUntil: null, pinned: false, projectId: null }, owns);
    expect(cleared.ok && Object.keys(cleared.patch).sort()).toEqual(["archivedAt", "pinned", "projectId", "snoozedUntil"]);
    expect(cleared.ok && Object.values(cleared.patch).every((value) => value === undefined)).toBe(true);
    expect(parseThreadOrganization({ projectId: "f2" }, owns, "projectId must belong to this bot, or null to ungroup the thread"))
      .toEqual({ ok: false, error: "projectId must belong to this bot, or null to ungroup the thread" });
    expect(parseThreadOrganization({ archivedAt: -1 }, owns)).toMatchObject({ ok: false });
    expect(parseThreadOrganization({ snoozedUntil: "soon" }, owns)).toMatchObject({ ok: false });
    expect(parseThreadOrganization({ pinned: "yes" }, owns)).toMatchObject({ ok: false });
  });
});
