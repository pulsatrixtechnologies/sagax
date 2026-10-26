import { Children, createElement, isValidElement, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, Group } from "@/state/store";
import type { SidebarDensity } from "@/lib/sidebar-preferences";

const fixture = vi.hoisted(() => ({ showThreads: true, state: {} as Partial<AppState>, dispatch: vi.fn() }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => fixture.showThreads, useThreadsLocationChoice: () => "header" }));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
vi.mock("react-dom", () => ({ createPortal: (node: ReactNode) => node }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, ...fixture.state }, dispatch: fixture.dispatch }) };
});

import { BotContextMenu, BotListItem, GroupListItem } from "./Sidebar";
import { SidebarBotActivity, sidebarBotActivityTasks } from "./SidebarBotActivity";

const bot: Bot = {
  id: "atlas", threadId: "last-selected", name: "Atlas", title: "", description: "",
  notifications: true, color: "green", unread: true,
  modelSelection: { instanceId: "fake", model: "test" }, messages: [],
  projects: [{ id: "private-folder", name: "Quiet folder" }],
  // Threads hidden (the single stream): "idle-history" and "last-selected"
  // are its topics, the newest last; the jobs the bot opened stay apart and
  // show as activity rows.
  tasks: [
    { threadId: "last-selected", title: "Last selected conversation", createdAt: 1 },
    { threadId: "idle-history", title: "Idle history", createdAt: 0, projectId: "private-folder" },
    { threadId: "approval", title: "Review permission", createdAt: 3, busy: false, activity: "waiting-on-you", projectId: "private-folder", openedBy: { botId: "atlas", name: "Atlas", at: 3 } },
    { threadId: "working", title: "Running job", createdAt: 4, busy: true, activity: "working", openedBy: { botId: "atlas", name: "Atlas", at: 4 } },
    { threadId: "queued", title: "Next job", createdAt: 5, openedBy: { botId: "atlas", name: "Atlas", at: 5 } },
    { threadId: "unread", title: "Finished reply", createdAt: 6, unread: true, openedBy: { botId: "atlas", name: "Atlas", at: 6 } },
  ],
};
// Opening a bot by hand or by name shows what it opens to: no fresh topic
// drawn over it (#763, src/lib/fresh-topic.ts).
const cleared = { type: "freshTopic", botId: "atlas", threadId: null };
const densities: SidebarDensity[] = ["comfortable", "compact", "icons"];
const rowProps = (density: SidebarDensity) => ({ bot, density, onMenu: vi.fn() });

type ElementProps = { children?: ReactNode; onClick?: (event: MouseEvent) => void; onKeyDown?: (event: KeyboardEvent) => void; [key: string]: unknown };
function findElement(tree: ReactNode, attribute: string, value: string): ReactElement<ElementProps> | undefined {
  for (const child of Children.toArray(tree)) {
    if (!isValidElement<ElementProps>(child)) continue;
    if (child.props[attribute] === value) return child;
    const found = findElement(child.props.children, attribute, value);
    if (found) return found;
  }
}

beforeEach(() => {
  fixture.showThreads = true;
  fixture.state = { bots: [bot], selectedId: "other-bot", activeView: "chat", pendingQueued: { queued: [{ queueId: "q", text: "next" }] } };
  fixture.dispatch.mockClear();
  vi.stubGlobal("window", { innerWidth: 1024, innerHeight: 768 });
  vi.stubGlobal("document", { body: {} });
  vi.stubGlobal("HTMLInputElement", class {});
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("bot-first sidebar", () => {
  it.each([
    // Grok Bot's comfortable row: a 36px portrait, 54px tall, 8px padding;
    // its rail: a 54px square, 9px around the portrait
    { enabled: true, density: "comfortable", size: 36, spacing: ["h-[54px]", "gap-2", "py-2", "pl-2", "rounded-[10px]"] },
    { enabled: true, density: "compact", size: 28, spacing: ["gap-2", "py-1.5", "pl-2"] },
    { enabled: true, density: "icons", size: 36, spacing: ["h-[54px]", "w-[54px]", "justify-center", "p-[9px]", "rounded-[10px]"] },
    { enabled: false, density: "comfortable", size: 36, spacing: ["h-[54px]", "gap-2", "py-2", "pl-2", "rounded-[10px]"] },
    { enabled: false, density: "compact", size: 28, spacing: ["gap-2", "py-1.5", "pl-2"] },
    { enabled: false, density: "icons", size: 36, spacing: ["h-[54px]", "w-[54px]", "justify-center", "p-[9px]", "rounded-[10px]"] },
  ] as const)("sizes bot portraits and row spacing in $density density with threads $enabled", ({ enabled, density, size, spacing }) => {
    fixture.showThreads = enabled;
    for (const avatar of [{}, { avatarUrl: "/api/attachments/portrait.png", avatarCrop: "circle" as const }]) {
      let tree: ReactNode;
      function Capture() { tree = BotListItem({ ...rowProps(density), bot: { ...bot, ...avatar } }); return tree; }
      const markup = renderToStaticMarkup(createElement(Capture));
      const row = findElement(tree, "data-sidebar-bot-row", bot.id)!;
      expect(String(row.props.className).split(" ")).toEqual(expect.arrayContaining([...spacing]));
      // the image and the owl's svg both carry the portrait size as attributes
      expect(markup).toContain(`width="${size}" height="${size}"`);
    }
  });

  for (const enabled of [true, false]) {
    it.each(densities)(`opens the last selected conversation on mouse or keyboard, %s density, threads ${enabled ? "on" : "off"}`, (density) => {
      fixture.showThreads = enabled;
      let tree: ReactNode;
      function Capture() { tree = BotListItem(rowProps(density)); return tree; }
      renderToStaticMarkup(createElement(Capture));
      const row = findElement(tree, "data-sidebar-bot-row", bot.id)!;
      row.props.onClick!({ type: "click", target: {} } as MouseEvent);
      // Opening the bot by hand shows the topic it opens to: no fresh topic
      // is drawn over it (#763: the draft is cleared, src/lib/fresh-topic.ts).
      const opened = [[{ type: "select", id: bot.id }], [cleared]];
      expect(fixture.dispatch.mock.calls).toEqual(opened);
      // Nobody has written here yet, so the selection is the bot's main
      // thread too: opening it must not create or switch a task.
      expect(bot.threadId).toBe("last-selected");
      for (const key of ["Enter", " "]) {
        fixture.dispatch.mockClear();
        const preventDefault = vi.fn();
        row.props.onKeyDown!({ key, preventDefault } as unknown as KeyboardEvent);
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(fixture.dispatch.mock.calls).toEqual(opened);
      }
    });
  }

  it.each(densities)("stays in a New topic it is on, %s density, threads off", (density) => {
    const trapped: Bot = { ...bot, threadId: "extra", tasks: [
      { threadId: "main", title: "Main", createdAt: 1, updatedAt: 50 },
      { threadId: "extra", title: "Untitled", createdAt: 60, updatedAt: 60 },
    ] };
    for (const enabled of [false, true]) {
      fixture.showThreads = enabled;
      fixture.dispatch.mockClear();
      let tree: ReactNode;
      function Capture() { tree = BotListItem({ ...rowProps(density), bot: trapped }); return tree; }
      renderToStaticMarkup(createElement(Capture));
      findElement(tree, "data-sidebar-bot-row", bot.id)!.props.onClick!({ type: "click", target: {} } as MouseEvent);
      // The single stream keeps a New topic it is on: the topic before is
      // drawn above it, so nothing is stranded.
      expect(fixture.dispatch.mock.calls).toEqual([[{ type: "select", id: bot.id }], [cleared]]);
    }
  });

  it.each(densities)("opens the newest topic of the stream when threads are hidden, %s density", (density) => {
    // Threads were on once: this window still sits on an older topic and the
    // person last wrote in it (the main thread, server/main-thread.ts). With
    // the tree hidden, the stream opens at its newest topic, the older one
    // drawn above it.
    const used = { ...bot, threadId: "idle-history", mainThreadId: "idle-history" };
    for (const enabled of [false, true]) {
      fixture.showThreads = enabled;
      // the switch, then no fresh topic over what it opens (#763): the switch
      // clears it, and so does the landing on a topic that is not idle
      const opened = enabled
        ? [[{ type: "select", id: bot.id }], [cleared]]
        : [[{ type: "switchTask", botId: bot.id, threadId: "last-selected" }], [cleared], [cleared]];
      let tree: ReactNode;
      function Capture() { tree = BotListItem({ ...rowProps(density), bot: used }); return tree; }
      renderToStaticMarkup(createElement(Capture));
      const row = findElement(tree, "data-sidebar-bot-row", bot.id)!;
      fixture.dispatch.mockClear();
      row.props.onClick!({ type: "click", target: {} } as MouseEvent);
      expect(fixture.dispatch.mock.calls).toEqual(opened);
      fixture.dispatch.mockClear();
      row.props.onKeyDown!({ key: "Enter", preventDefault: vi.fn() } as unknown as KeyboardEvent);
      expect(fixture.dispatch.mock.calls).toEqual(opened);
    }
  });

  it.each(densities)("lists nothing under the bot with threads on in %s density", (density) => {
    fixture.state.selectedId = bot.id;
    const markup = renderToStaticMarkup(createElement(BotListItem, rowProps(density)));
    // no thread rows, folders, activity rows, "My conversations" heading, or toggle
    expect(markup).not.toContain("data-sidebar-thread-row");
    expect(markup).not.toContain("data-sidebar-folder-row");
    expect(markup).not.toContain("data-sidebar-activity-row");
    expect(markup).not.toContain("data-sidebar-bot-activity");
    expect(markup).not.toContain("data-sidebar-my-threads");
    expect(markup).not.toContain("My conversations");
    expect(markup).not.toContain("Idle history");
    expect(markup).not.toContain("Quiet folder");
    expect(markup).not.toContain("Atlas threads");
    // the row itself still says a sibling waits, and that something is unread
    expect(markup).toContain('data-testid="waiting-dot"');
    if (density !== "icons") {
      expect(markup).toContain('aria-current="page"');
      expect(markup).toMatch(/sr-only[^>]*>Unread threads</); // bold name plus a screen-reader label, no dot (478bd6216)
      // New thread beside the bot's "..." (JC, 2026-10-15)
      expect(markup).toContain('aria-label="New thread"');
    }
  });

  it.each(["comfortable", "compact"] as const)("starts a thread from the row's New thread button, %s density", (density) => {
    let tree: ReactNode;
    function Capture() { tree = BotListItem(rowProps(density)); return tree; }
    renderToStaticMarkup(createElement(Capture));
    const button = findElement(tree, "data-sidebar-bot-new-thread", bot.id)!;
    expect(button.props["aria-label"]).toBe("New thread");
    // revealed on hover and keyboard focus, always visible on touch screens
    expect(String(button.props.className)).toContain("group-focus-within:opacity-100");
    expect(String(button.props.className)).toContain("touch:opacity-70");
    fixture.dispatch.mockClear();
    button.props.onClick!({} as MouseEvent);
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "newTask", botId: bot.id });
  });

  it.each(densities)("hides thread browsing and creation but keeps attention accessible in %s density", (density) => {
    fixture.showThreads = false;
    const markup = renderToStaticMarkup(createElement(BotListItem, rowProps(density)));
    expect(markup).not.toContain("data-sidebar-thread-row");
    expect(markup).not.toContain("data-sidebar-folder-row");
    expect(markup).not.toContain("Idle history");
    expect(markup).not.toContain("Quiet folder");
    expect(markup).not.toContain("New thread");
    expect(markup).not.toContain("New folder");
    expect(markup).not.toContain("Expand Atlas threads");
    expect(markup).toContain('data-testid="waiting-dot"');
    for (const id of ["approval", "working", "queued", "unread"]) expect(markup).toContain(`data-sidebar-activity-row="${id}"`);
    expect(markup).toContain('aria-label="Atlas: Review permission · Waiting for you…"');
    expect(markup).toContain('aria-label="Atlas: Next job · Queued"');
    expect(markup).toContain('aria-label="Atlas: Finished reply · Unread"');
  });

  it("offers New thread first in the bot context menu with threads on, and no folder creation", () => {
    const onClose = vi.fn();
    const render = () => {
      let tree: ReactNode;
      function Capture() {
        tree = BotContextMenu({
          menu: { botId: bot.id, x: 0, y: 0 }, onClose, onArchive: vi.fn(), onDelete: vi.fn(), onMoveToSection: vi.fn(), onRename: vi.fn(),
        });
        return tree;
      }
      return { html: renderToStaticMarkup(createElement(Capture)), tree: () => tree };
    };
    for (const shown of [true, false]) {
      fixture.showThreads = shown;
      const main = render();
      expect(main.html).toContain("Rename the bot");
      expect(main.html).toContain(">Move to<");
      expect(main.html).toContain("Hide from sidebar");
      const ids = [...main.html.matchAll(/data-menu-item="([\w-]+)"/g)].map((match) => match[1]);
      if (shown) {
        // the first entry, at the first level (JC, 2026-10-15)
        expect(ids[0]).toBe("new-thread");
        expect(main.html).toContain(">New thread<");
        fixture.dispatch.mockClear();
        findElement(main.tree(), "data-menu-item", "new-thread")!.props.onClick!({} as MouseEvent);
        expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "newTask", botId: bot.id });
        expect(onClose).toHaveBeenCalled();
      } else {
        expect(main.html).not.toContain("New thread");
      }
      expect(main.html.split("New thread").length).toBeLessThanOrEqual(2);
      expect(main.html).not.toContain("New folder");
    }
  });

  it("Edit bot on the remote client's menu opens the panel without naming a section", () => {
    vi.stubGlobal("window", { innerWidth: 1024, innerHeight: 768, ogb: { remoteClient: { active: true } } });
    let tree: ReactNode;
    // call the menu inside a render so its hooks run and the returned tree
    // carries the items' handlers
    function Capture() {
      tree = BotContextMenu({ menu: { botId: bot.id, x: 0, y: 0 }, onClose: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn(), onMoveToSection: vi.fn(), onRename: vi.fn() });
      return tree;
    }
    const editProfile = () => {
      const items: ReactElement<ElementProps>[] = [];
      const walk = (node: ReactNode) => {
        for (const child of Children.toArray(node)) {
          if (!isValidElement<ElementProps>(child)) continue;
          if (child.props.role === "menuitem") items.push(child);
          walk(child.props.children);
        }
      };
      walk(tree);
      return items.find((item) => Children.toArray(item.props.children).includes("Edit bot"))!;
    };
    const render = () => renderToStaticMarkup(createElement(Capture));

    // the panel is closed: select the bot, then a bare open
    render();
    editProfile().props.onClick!({} as MouseEvent);
    expect(fixture.dispatch.mock.calls).toEqual([
      [{ type: "select", id: bot.id }],
      [cleared],
      [{ type: "toggleSettings", open: true }],
    ]);

    // already open: only the retarget, never a section
    fixture.dispatch.mockClear();
    fixture.state.settingsOpen = true;
    render();
    editProfile().props.onClick!({} as MouseEvent);
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "select", id: bot.id }], [cleared]]);
  });


  it("does not change group collaboration histories or creation", () => {
    fixture.showThreads = false;
    const group: Group = {
      id: "group", name: "Planning", threadId: "group-thread", memberIds: [], defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: 0, messages: [],
      tasks: [{ threadId: "group-thread", title: "Group conversation", createdAt: 1 }, { threadId: "group-earlier", title: "Earlier planning", createdAt: 0 }],
    };
    fixture.state.selectedId = group.id;
    const markup = renderToStaticMarkup(createElement(GroupListItem, { group, density: "comfortable", onMenu: vi.fn() }));
    expect(markup).not.toContain('data-sidebar-thread-row="group-thread"');
    expect(markup).toContain('aria-label="New thread"');
    expect(markup).not.toContain('aria-label="Collapse Planning threads"');
    const working = renderToStaticMarkup(createElement(GroupListItem, { group: { ...group, working: true }, density: "comfortable", onMenu: vi.fn() }));
    expect(working).toMatch(/<button type="button" disabled="" aria-label="New thread"/);
    // a room with one thread is that thread: no disclosure, no duplicate row
    const single = renderToStaticMarkup(createElement(GroupListItem, { group: { ...group, tasks: [group.tasks![0]] }, density: "comfortable", onMenu: vi.fn() }));
    expect(single).not.toContain("Planning threads");
    expect(single).not.toContain('data-sidebar-thread-row=');
    const searched = renderToStaticMarkup(createElement(GroupListItem, {
      group: { ...group, tasks: [group.tasks![0]] }, density: "comfortable", query: "conversation", onMenu: vi.fn(),
    }));
    expect(searched).not.toContain('data-sidebar-thread-row="group-thread"');
  });
});

describe("group rows line up with bot rows", () => {
  const twoBots: Group = {
    id: "group", name: "Dumpling & co.", threadId: "group-thread", memberIds: ["atlas", "pepper"], defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: 0, messages: [],
    tasks: [{ threadId: "group-thread", title: "Group conversation", createdAt: 1 }],
  };
  const pepper: Bot = { ...bot, id: "pepper", name: "Pepper", tasks: [], projects: [] };
  const rowClass = (markup: string, marker: string) => markup.match(new RegExp(`${marker}[^>]*class="([^"]*)"`))?.[1]
    ?? markup.match(new RegExp(`class="([^"]*)"[^>]*${marker}`))?.[1] ?? "";

  it.each([true, false])("puts a room row at the bot row's inset and 36px box with showThreads=%s in the header location, no outline around stacked faces", (showThreads) => {
    fixture.showThreads = showThreads;
    fixture.state.bots = [bot, pepper];
    const groupMarkup = renderToStaticMarkup(createElement(GroupListItem, { group: twoBots, density: "comfortable", onMenu: vi.fn() }));
    const botMarkup = renderToStaticMarkup(createElement(BotListItem, { bot: pepper, density: "comfortable", onMenu: vi.fn() }));
    // a room lists its threads under the row only in the sidebar location,
    // like a bot and a person, so in the header location it never moves
    expect(rowClass(groupMarkup, 'data-sidebar-group-row="group"').split(" ")).toContain("pl-2");
    expect(rowClass(groupMarkup, 'data-sidebar-group-row="group"').split(" ")).not.toContain("pl-6");
    expect(rowClass(botMarkup, 'data-sidebar-bot-row="pepper"').split(" ")).toContain("pl-2");
    expect(rowClass(botMarkup, 'data-sidebar-bot-row="pepper"').split(" ")).not.toContain("pl-6");
    // same 36px avatar footprint as the bot row (Grok Bot's)
    expect(groupMarkup).toContain("relative shrink-0 size-9");
    expect(groupMarkup).not.toMatch(/ring-2 ring-panel/);
  });
});

describe("people rows line up with bot rows", () => {
  const person: Group = {
    id: "dm-ada", name: "Ada Example", peopleDm: true, humanIds: ["pr_me", "pr_ada"], threadId: "dm-thread", memberIds: [], defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: 0, messages: [],
    tasks: [{ threadId: "dm-thread", title: "Ada", createdAt: 2 }, { threadId: "dm-earlier", title: "Earlier", createdAt: 1 }],
  } as Group;
  const inset = (cls: string) => cls.split(" ").filter((c) => /^(pl|px)-/.test(c));
  const classOf = (markup: string, marker: string) => markup.match(new RegExp(`${marker}[^>]*class="([^"]*)"`))?.[1]
    ?? markup.match(new RegExp(`class="([^"]*)"[^>]*${marker}`))?.[1] ?? "";

  it.each([
    { showThreads: true, density: "comfortable" as const },
    { showThreads: false, density: "comfortable" as const },
    { showThreads: true, density: "compact" as const },
    { showThreads: false, density: "compact" as const },
  ])("shares the bot row's left inset with showThreads=$showThreads, $density density, and has no chevron", ({ showThreads, density }) => {
    fixture.showThreads = showThreads;
    fixture.state.bots = [bot];
    const personMarkup = renderToStaticMarkup(createElement(GroupListItem, { group: person, density, onMenu: vi.fn() }));
    const botMarkup = renderToStaticMarkup(createElement(BotListItem, { bot, density, onMenu: vi.fn() }));
    const personInset = inset(classOf(personMarkup, 'data-sidebar-group-row="dm-ada"'));
    const botInset = inset(classOf(botMarkup, `data-sidebar-bot-row="${bot.id}"`));
    expect(personInset).toEqual(["pl-2"]);
    expect(personInset).toEqual(botInset);
    expect(personMarkup).not.toContain("Ada Example threads");
    // no achievement title or points on a person's row
    expect(personMarkup).not.toContain("data-member-line");
    expect(personMarkup).not.toContain("data-gamertag");
  });
});

describe("bot row does not move with thread mode", () => {
  const stripButtonPadding = (cls: string) => cls.split(" ").filter((c) => !/pr-\[5\.75rem\]/.test(c)).sort();
  it.each(["comfortable", "compact", "icons"] as const)("has the same wrapper and avatar classes with threads on and off, %s density", (density) => {
    const grab = (showThreads: boolean) => {
      fixture.showThreads = showThreads;
      let tree: ReactNode;
      function Capture() { tree = BotListItem({ ...rowProps(density), bot }); return tree; }
      const markup = renderToStaticMarkup(createElement(Capture));
      const row = findElement(tree, "data-sidebar-bot-row", bot.id)!;
      const avatar = markup.match(/<span class="relative flex shrink-0[^"]*"[^>]*>/)?.[0];
      return { row: stripButtonPadding(String(row.props.className)), avatar };
    };
    const on = grab(true);
    const off = grab(false);
    expect(on.row).toEqual(off.row);
    expect(on.avatar).toBeDefined();
    expect(on.avatar).toEqual(off.avatar);
  });
});

describe("group preview", () => {
  it("previews the last reply, not the digest receipt that follows it", () => {
    const group: Group = {
      id: "group", name: "Planning", threadId: "group-thread", memberIds: [], defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: 0,
      messages: [
        { id: "b1", role: "bot", kind: "text", text: "Plan drafted.", at: 2, from: { botId: "atlas", name: "Atlas", color: "green" } },
        { id: "d1", role: "bot", kind: "digest", text: "[digest] · tools: Write ×1", at: 3, digest: { turnId: "t1", tools: [{ name: "Write", count: 1 }], hookCoverage: "full" } },
      ] as Group["messages"],
      tasks: [{ threadId: "group-thread", title: "Group conversation", createdAt: 1 }],
    };
    const markup = renderToStaticMarkup(createElement(GroupListItem, { group, density: "comfortable", onMenu: vi.fn() }));
    expect(markup).toContain("Atlas: Plan drafted.");
    expect(markup).not.toContain("[digest]");
  });
});

describe("activity-only escape hatch", () => {
  it("includes waiting approvals even with busy false and never treats aggregate activity as every sibling's status", () => {
    const tasks = sidebarBotActivityTasks({ ...bot, busy: true, activity: "waiting-on-you" }, fixture.state.pendingQueued!);
    expect(tasks.map((task) => task.threadId)).toEqual(["approval", "working", "queued", "unread"]);
  });

  it("switches directly to the requested work and offers no thread-management actions", () => {
    let tree: ReactNode;
    function Capture() { tree = SidebarBotActivity({ bot, rowThreadId: bot.threadId, density: "comfortable", pendingQueued: fixture.state.pendingQueued!, dispatch: fixture.dispatch }); return tree; }
    const markup = renderToStaticMarkup(createElement(Capture));
    findElement(tree, "data-sidebar-activity-row", "approval")!.props.onClick!({} as MouseEvent);
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "switchTask", botId: bot.id, threadId: "approval" });
    expect(markup).not.toContain("Actions for");
    expect(markup).not.toContain("New thread");
    expect(markup).not.toContain("Delete");
  });

  it("removes selected and settled activity but keeps unread completed replies", () => {
    const selected = { ...bot, threadId: "approval", tasks: bot.tasks!.map((task) => task.threadId === "working" ? { ...task, busy: false, activity: "idle" as const } : task) };
    const markup = renderToStaticMarkup(createElement(SidebarBotActivity, { bot: selected, rowThreadId: selected.threadId, density: "compact", pendingQueued: fixture.state.pendingQueued!, dispatch: fixture.dispatch }));
    expect(markup).not.toContain('data-sidebar-activity-row="approval"');
    expect(markup).not.toContain('data-sidebar-activity-row="working"');
    expect(markup).toContain('data-sidebar-activity-row="unread"');
  });

  it("lists a reply in the thread a bot was left on, since its row opens the main thread", () => {
    // This window left Atlas on an older thread a routine's reply has since
    // landed in; the person last wrote in another one, the main thread.
    const left: Bot = { ...bot, threadId: "left-behind", mainThreadId: "main-chat", tasks: [
      { threadId: "left-behind", title: "Routine report", createdAt: 1, unread: true },
      { threadId: "main-chat", title: "Main chat", createdAt: 2, unread: true },
    ] };
    const rows = () => {
      const markup = renderToStaticMarkup(createElement(BotListItem, { ...rowProps("comfortable"), bot: left }));
      return ["left-behind", "main-chat"].filter((threadId) => markup.includes(`data-sidebar-activity-row="${threadId}"`));
    };
    fixture.showThreads = false;
    expect(rows()).toEqual(["left-behind"]);
    // On screen, the thread it shows is the row, and the main thread a sibling.
    fixture.state.selectedId = left.id;
    expect(rows()).toEqual(["main-chat"]);
    // With threads shown nothing is listed under the bot (Sagax: the chat
    // header's thread button is the one place for threads).
    fixture.showThreads = true;
    fixture.state.selectedId = "other-bot";
    expect(rows()).toEqual([]);
  });
});
