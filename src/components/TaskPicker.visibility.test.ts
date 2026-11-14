import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => ({
  showThreads: true,
  location: "header" as "header" | "sidebar",
  queued: {} as Record<string, unknown[]>,
  bots: [] as Bot[],
  groups: [] as Group[],
  threadReturn: null as null | { ownerId: string; threadId: string },
  dispatch: vi.fn(),
}));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => fixture.showThreads, useThreadsLocationChoice: () => fixture.location, useThreadsMode: () => ((fixture.showThreads) ? fixture.location : "one") as "one" | "header" | "sidebar" }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({
    state: { bots: fixture.bots, groups: fixture.groups, pendingQueued: fixture.queued, threadReturn: fixture.threadReturn },
    dispatch: fixture.dispatch,
  }),
}));

const { TaskPicker, GroupTaskPicker, ThreadReturnLink, ThreadsOffReturnLink, botPickerThreads, botPickerBackground } = await import("./TaskPicker");
const bot: Bot = {
  id: "pepper", name: "Pepper", color: "green", threadId: "current", title: "", description: "",
  notifications: true, unread: false, busy: true, messages: [], modelSelection: { instanceId: "fake", model: "fake" },
  tasks: [
    { threadId: "current", title: "Current chat", createdAt: 1, busy: true, activity: "working" },
    { threadId: "idle", title: "Quiet history", createdAt: 2, busy: false },
    { threadId: "waiting", title: "Approval needed", createdAt: 3, busy: false, activity: "waiting-on-you" },
    { threadId: "working", title: "Research", createdAt: 4, busy: true, activity: "working" },
    { threadId: "queued", title: "Next job", createdAt: 5, busy: false },
    { threadId: "unread", title: "Finished reply", createdAt: 6, unread: true },
  ],
};
beforeEach(() => {
  fixture.showThreads = true;
  fixture.location = "header";
  fixture.queued = {};
  fixture.bots = [];
  fixture.groups = [];
  fixture.threadReturn = null;
  fixture.dispatch.mockClear();
});

describe("optional bot thread picker", () => {
  it("keeps the usual picker when threads are shown", () => {
    expect(renderToStaticMarkup(createElement(TaskPicker, { bot }))).toContain('aria-label="All threads"');
  });

  // Settings > Conversation threads: the thread control is in the chat
  // header in the "In the chat header" mode only; one conversation and the
  // sidebar mode have none there (no picker, no activity selector).
  it("draws the bot's thread control in the chat header mode only", () => {
    fixture.location = "header";
    expect(renderToStaticMarkup(createElement(TaskPicker, { bot }))).toContain('aria-label="All threads"');
    fixture.location = "sidebar";
    expect(renderToStaticMarkup(createElement(TaskPicker, { bot }))).toBe("");
    fixture.location = "header";
    fixture.showThreads = false;
    expect(renderToStaticMarkup(createElement(TaskPicker, { bot }))).toBe("");
  });

  it("shows the channel picker only while threads are on, as a round header button", () => {
    const group: Group = { id: "team", name: "Team", threadId: "team-current", memberIds: [], defaultResponder: { kind: "everyone" }, bulletin: "", createdAt: 1, unread: false, messages: [],
      tasks: [{ threadId: "team-current", title: "Channel discussion", createdAt: 1 }] };
    const shown = renderToStaticMarkup(createElement(GroupTaskPicker, { group }));
    expect(shown).toContain('aria-label="All threads"');
    expect(shown).toContain("rounded-full border");
    // the sidebar location lists the room's threads under its row instead
    fixture.location = "sidebar";
    expect(renderToStaticMarkup(createElement(GroupTaskPicker, { group }))).toBe("");
    fixture.location = "header";
    fixture.showThreads = false;
    expect(renderToStaticMarkup(createElement(GroupTaskPicker, { group }))).toBe("");
  });

  it("draws the bot picker as the header's round outlined button", () => {
    const markup = renderToStaticMarkup(createElement(TaskPicker, { bot }));
    expect(markup).toContain("rounded-full border");
    expect(markup).toContain('aria-expanded="false"');
  });
});

describe("the header picker lists only the open bot's threads", () => {
  // Other bots and rooms with threads that need the person: before
  // 2026-10-08 they rode into this picker as an inbox section.
  const talon: Bot = { ...bot, id: "talon", name: "Talon", threadId: "talon-main", busy: false,
    tasks: [{ threadId: "talon-main", title: "Talon work", createdAt: 1, unread: true }, { threadId: "talon-wait", title: "Talon approval", createdAt: 2, activity: "waiting-on-you" }] };
  const room: Group = { id: "crew", name: "Crew", threadId: "crew-main", memberIds: [], defaultResponder: { kind: "everyone" }, bulletin: "", createdAt: 1, unread: true, messages: [],
    tasks: [{ threadId: "crew-main", title: "Crew chat", createdAt: 1 }] };
  // a thread a peer bot opened on Pepper is background work (unified chat,
  // 2026-11-05): behind "Show background", never in the list; one the person
  // wrote in is theirs and listed
  const pepper: Bot = { ...bot, tasks: [...bot.tasks!,
    { threadId: "peer-opened", title: "@Talon · work", createdAt: 7, openedBy: { botId: "talon", name: "Talon", kind: "work", at: 7 } },
    { threadId: "peer-adopted", title: "Talon asked", createdAt: 9, personWrote: true, openedBy: { botId: "talon", name: "Talon", at: 9 } },
    { threadId: "agent", title: "From Claude", createdAt: 10, openedBy: { botId: "agent:claude", name: "Claude", kind: "agent", at: 10 } },
    { threadId: "routine-run", title: "Nightly", createdAt: 8, routineRunId: "run-1" }] };

  it("lists this bot's own threads and nothing from other bots or rooms", () => {
    fixture.bots = [pepper, talon];
    fixture.groups = [room];
    const markup = renderToStaticMarkup(createElement(TaskPicker, { bot: pepper, initialOpen: true }));
    for (const title of ["Current chat", "Quiet history", "Approval needed", "Research", "Next job", "Finished reply", "Talon asked"]) expect(markup).toContain(title);
    expect(markup).toContain("opened by Talon");
    for (const title of ["Talon work", "Talon approval", "Crew chat", "Nightly", "Inbox", "@Talon · work", "From Claude"]) expect(markup).not.toContain(title);
    expect(markup).toContain("data-picker-background");
    expect(markup).toContain("Show background");
    expect(botPickerThreads(pepper).map((task) => task.threadId).sort())
      .toEqual(["current", "idle", "waiting", "working", "queued", "unread", "peer-adopted"].sort());
  });

  it("lists background work behind Show background, newest first, never a routine run", () => {
    expect(botPickerBackground(pepper).map((task) => task.threadId)).toEqual(["agent", "peer-opened"]);
    // the one on screen stays in the list, opened from its card
    expect(botPickerThreads({ ...pepper, threadId: "peer-opened" }).map((task) => task.threadId)).toContain("peer-opened");
  });

  it("gives each row the actions the sidebar rows had, and each folder its actions", () => {
    const filed: Bot = { ...pepper, projects: [{ id: "research", name: "Research" }],
      tasks: pepper.tasks!.map((task) => task.threadId === "idle" ? { ...task, projectId: "research" } : task) };
    const markup = renderToStaticMarkup(createElement(TaskPicker, { bot: filed, initialOpen: true }));
    expect(markup).toContain('aria-label="Actions for Quiet history"');
    expect(markup).toContain('aria-label="Actions for Research folder"');
    expect(markup).toContain('data-picker-folder="research"');
  });

  it("keeps a peer-opened thread the person wrote in, labelled by who opened it", () => {
    const row = botPickerThreads(pepper).find((task) => task.threadId === "peer-adopted");
    expect(row?.openedBy?.name).toBe("Talon");
  });
});

describe("way back to the conversation while threads are hidden", () => {
  const trapped: Bot = {
    ...bot, busy: false, threadId: "extra",
    tasks: [
      { threadId: "main", title: "Weekly report", createdAt: 1, updatedAt: 50 },
      // outside the single stream: an empty New topic is the live topic and
      // needs no way back (the topics before it are drawn above)
      { threadId: "extra", title: "Untitled", createdAt: 60, updatedAt: 60, confidential: true },
    ],
  };

  it("offers a link back to the latest conversation and switches to it", async () => {
    fixture.showThreads = false;
    const markup = renderToStaticMarkup(createElement(ThreadsOffReturnLink, { bot: trapped }));
    expect(markup).toContain("data-threads-off-return");
    expect(markup).toContain("Back to conversation");
    expect(markup).toContain('title="Weekly report"');
    const { Children, isValidElement } = await import("react");
    type El = { props: { onClick?: () => void; children?: unknown } };
    const find = (node: unknown): El | undefined => {
      if (!isValidElement(node)) return undefined;
      const el = node as unknown as El;
      if (el.props.onClick) return el;
      for (const child of Children.toArray(el.props.children as never)) { const hit = find(child); if (hit) return hit; }
    };
    let tree: unknown;
    renderToStaticMarkup(createElement(() => { tree = ThreadsOffReturnLink({ bot: trapped }); return tree as never; }));
    find(tree)?.props.onClick?.();
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "switchTask", botId: "pepper", threadId: "main" });
  });

  it("offers the conversation a thread chip left, even while threads stay hidden", () => {
    fixture.showThreads = false;
    fixture.bots = [bot];
    fixture.threadReturn = { ownerId: "pepper", threadId: "idle" };
    const markup = renderToStaticMarkup(createElement(ThreadReturnLink, { ownerId: "pepper", threadId: "current" }));
    expect(markup).toContain("data-thread-return");
    expect(markup).toContain("Back to conversation");
    expect(markup).toContain('title="Quiet history"');
    // read inside a render: the link reads the store through selector hooks
    // since the idle cost fix (#3624), so it cannot be called bare
    let link: ReturnType<typeof ThreadReturnLink> = null;
    renderToStaticMarkup(createElement(() => { link = ThreadReturnLink({ ownerId: "pepper", threadId: "current" }); return link; }));
    const button = (link as ReturnType<typeof ThreadReturnLink>)?.props.children;
    button.props.onClick();
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "switchTask", botId: "pepper", threadId: "idle" });
    expect(renderToStaticMarkup(createElement(ThreadReturnLink, { ownerId: "pepper", threadId: "idle" }))).toBe("");
  });

  it("stays out of the way at home and when threads are shown", () => {
    fixture.showThreads = false;
    expect(renderToStaticMarkup(createElement(ThreadsOffReturnLink, { bot: { ...trapped, threadId: "main" } }))).toBe("");
    fixture.showThreads = true;
    expect(renderToStaticMarkup(createElement(ThreadsOffReturnLink, { bot: trapped }))).toBe("");
  });
});
