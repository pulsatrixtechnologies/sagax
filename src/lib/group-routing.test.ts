import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "./i18n";
import { goalCoordinatorForComposer, groupComposerHint, openTaskWorking, preferredRoomLead, roomRespondersForComposer, roomTakesImages } from "./group-routing";
import type { Group, GroupDefaultResponder } from "@/state/store";

describe("openTaskWorking", () => {
  const tasks = [
    { threadId: "goal", title: "Weekly report", createdAt: 1, working: true },
    { threadId: "chat", title: "Questions", createdAt: 2, working: false },
  ] as Group["tasks"];

  it("locks a task's composer on its own work, not a background task's", () => {
    // the room counts the background goal; the open task is idle
    expect(openTaskWorking({ threadId: "chat", working: true, tasks })).toBe(false);
    expect(openTaskWorking({ threadId: "goal", working: true, tasks })).toBe(true);
  });

  it("reads the room's flag when no task list came", () => {
    expect(openTaskWorking({ threadId: "dm", working: true })).toBe(true);
    expect(openTaskWorking({ threadId: "dm", working: false })).toBe(false);
  });
});

describe("roomRespondersForComposer", () => {
  const members = [
    { id: "atlas", name: "Atlas" },
    { id: "milind", name: "Milind" },
  ];

  it("routes an unmentioned message to the configured lead", () => {
    expect(
      roomRespondersForComposer("hello there", members, { defaultResponder: { kind: "member", botId: "atlas" } }),
    ).toEqual([members[0]]);
  });

  it("lets explicit mentions override the configured lead", () => {
    expect(
      roomRespondersForComposer("@Milind take this", members, { defaultResponder: { kind: "member", botId: "atlas" } }),
    ).toEqual([members[1]]);
  });

  it("uses the shared Markdown, punctuation, and Unicode mention boundaries", () => {
    const mentionsOnly = { defaultResponder: { kind: "mentions" } } as const;
    expect(roomRespondersForComposer("**@Milind**", members, mentionsOnly)).toEqual([members[1]]);
    expect(roomRespondersForComposer("(@Milind)", members, mentionsOnly)).toEqual([members[1]]);
    expect(roomRespondersForComposer("【@Milind】", members, mentionsOnly)).toEqual([members[1]]);
    expect(roomRespondersForComposer("user@Milind /@Milind", members, mentionsOnly)).toEqual([]);
    expect(roomRespondersForComposer("@Milindo", members, mentionsOnly)).toEqual([]);
    expect(roomRespondersForComposer("@Milind𐐀", members, mentionsOnly)).toEqual([]);
    expect(roomRespondersForComposer("İ @Milind", members, mentionsOnly)).toEqual([members[1]]);
  });

  it("supports everyone and mentions-only room policies", () => {
    expect(roomRespondersForComposer("hello", members, { defaultResponder: { kind: "everyone" } })).toEqual(members);
    expect(roomRespondersForComposer("hello", members, { defaultResponder: { kind: "mentions" } })).toEqual([]);
    expect(roomRespondersForComposer("@everyone hello", members, { defaultResponder: { kind: "mentions" } })).toEqual(
      members,
    );
  });

  it("applies the shared mention boundaries to everyone", () => {
    const mentionsOnly = { defaultResponder: { kind: "mentions" } } as const;
    expect(roomRespondersForComposer("**@EVERYONE** hello", members, mentionsOnly)).toEqual(members);
    expect(roomRespondersForComposer("【@everyone】 hello", members, mentionsOnly)).toEqual(members);
    expect(roomRespondersForComposer("@everyone調査 hello", members, mentionsOnly)).toEqual([]);
    expect(roomRespondersForComposer("@everyone𐐀 hello", members, mentionsOnly)).toEqual([]);
    expect(roomRespondersForComposer("user@everyone /@everyone", members, mentionsOnly)).toEqual([]);
    expect(roomRespondersForComposer("İ @everyone", members, mentionsOnly)).toEqual(members);
  });
});

describe("goalCoordinatorForComposer", () => {
  const members = [
    { id: "first", name: "First" },
    { id: "chief", name: "Chief", chiefOfStaff: true },
    { id: "writer", name: "Writer" },
  ];

  it("uses an explicit mention before the configured lead", () => {
    expect(goalCoordinatorForComposer(
      "@Writer finish this",
      members,
      { defaultResponder: { kind: "member", botId: "first" } },
    )?.id).toBe("writer");
  });

  it("uses wrapped explicit mentions before the configured lead", () => {
    expect(goalCoordinatorForComposer(
      "**@Writer** finish this",
      members,
      { defaultResponder: { kind: "member", botId: "first" } },
    )?.id).toBe("writer");
  });

  it("falls back to the in-room Chief for mentions-only goal channels", () => {
    expect(goalCoordinatorForComposer(
      "finish this",
      members,
      { defaultResponder: { kind: "mentions" } },
    )?.id).toBe("chief");
  });

  it("#2045: falls back to the viewer's own Primary Bot only", () => {
    const room = [
      { id: "first", name: "First", ownerUserId: "person-a" },
      { id: "theirs", name: "Theirs", chiefOfStaff: true, ownerUserId: "person-b" },
      { id: "mine", name: "Mine", chiefOfStaff: true, ownerUserId: "person-a" },
    ];
    expect(goalCoordinatorForComposer("finish this", room, { defaultResponder: { kind: "mentions" } }, "person-a")?.id).toBe("mine");
    expect(goalCoordinatorForComposer("finish this", room, { defaultResponder: { kind: "mentions" } }, "person-b")?.id).toBe("theirs");
  });
});

describe("preferredRoomLead", () => {
  it("#2045: prefers the viewer's own Primary Bot over another person's", () => {
    const group = {
      memberIds: ["theirs", "mine", "peer"],
      defaultResponder: { kind: "mentions" as const },
    };
    const bots = [
      { id: "theirs", chiefOfStaff: true, ownerUserId: "person-b" },
      { id: "mine", chiefOfStaff: true, ownerUserId: "person-a" },
      { id: "peer", ownerUserId: "person-a" },
    ];
    expect(preferredRoomLead(group, bots, { viewerId: "person-a" })?.id).toBe("mine");
    expect(preferredRoomLead(group, bots, { viewerId: "person-b" })?.id).toBe("theirs");
  });
});

describe("composer hint, in the reader's language", () => {
  afterEach(() => {
    setLocale("en");
  });

  it("translates every routing case and keeps the lead's own name", () => {
    const members = [
      { id: "first", name: "Juniper" },
      { id: "lead", name: "Atlas" },
    ] as Parameters<typeof groupComposerHint>[1];
    const room = (defaultResponder: GroupDefaultResponder) =>
      ({ defaultResponder, dm: false }) as Parameters<typeof groupComposerHint>[0];

    setLocale("pt-br");
    expect(groupComposerHint(room({ kind: "everyone" }), members)).toBe("todos respondem");
    expect(groupComposerHint(room({ kind: "mentions" }), members)).toBe("@ para chamar um bot");
    // Select the non-first member so fallback routing cannot satisfy the assertion.
    expect(groupComposerHint(room({ kind: "member", botId: "lead" }), members)).toBe("Atlas responde");
    expect(groupComposerHint({ dm: true } as Parameters<typeof groupComposerHint>[0], members)).toBe(
      "continuar a conversa",
    );

    setLocale("ja");
    expect(groupComposerHint(room({ kind: "everyone" }), members)).toBe("全員が応答します");
  });
});

describe("roomTakesImages", () => {
  const no = () => false;
  it("lets a person-to-person chat carry images, since no bot answers there (#1067)", () => {
    expect(roomTakesImages({ peopleDm: true }, [], no)).toBe(true);
  });
  it("still needs every answering bot to read images in a bot room", () => {
    expect(roomTakesImages({}, [], no)).toBe(false);
    expect(roomTakesImages({}, ["a", "b"], (id) => id === "a")).toBe(false);
    expect(roomTakesImages({}, ["a"], (id) => id === "a")).toBe(true);
  });
});
