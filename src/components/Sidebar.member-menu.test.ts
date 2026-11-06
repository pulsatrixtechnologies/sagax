import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";
import { t } from "@/lib/i18n";
import { DEFAULT_SIDEBAR_HIDDEN, hiddenKey, readSidebarHidden, writeSidebarHidden } from "@/lib/sidebar-hidden";

// A person row (people-DM) gets the actions a member already has elsewhere:
// the profile, the conversation id, hide, unpin while pinned, the section
// submenu and mark unread. Not rename, delete or force-stop.
const fixture = vi.hoisted(() => ({
  portal: null as ReactElement | null,
  dispatch: vi.fn(),
  groups: [] as Group[],
  bots: [] as Bot[],
  config: { viewer: { principalId: "pr_me" } } as { viewer: { principalId: string } },
}));
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, useLayoutEffect: () => {} };
});
vi.mock("react-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-dom")>();
  return {
    ...original,
    createPortal: (node: ReactNode) => {
      fixture.portal = node as ReactElement;
      return node;
    },
  };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, bots: fixture.bots, groups: fixture.groups, config: fixture.config },
      dispatch: fixture.dispatch,
    }),
  };
});

const { BotContextMenu, RoomContextMenu, memberMenuItems } = await import("./Sidebar");

const baseGroup = {
  memberIds: [] as string[],
  defaultResponder: { kind: "mentions" as const },
  bulletin: "",
  unread: false,
  createdAt: 1,
  messages: [] as Group["messages"],
};

function personRow(pinned = false): Group {
  return {
    ...baseGroup,
    id: "dm-morgan",
    threadId: "thread-morgan",
    name: "Sam Taylor",
    humanIds: ["pr_me", "pr_morgan"],
    peopleDm: true,
    ...(pinned ? { pinned: true } : {}),
  };
}

function room(): Group {
  return {
    ...baseGroup,
    id: "ops",
    threadId: "thread-ops",
    name: "Ops",
    humanIds: ["pr_me"],
    memberIds: ["bot-1"],
  };
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  const out: ReactElement<Record<string, unknown>>[] = [];
  const walk = (value: ReactNode) => Children.forEach(value, (child) => {
    if (Array.isArray(child)) return walk(child);
    if (!isValidElement<Record<string, unknown>>(child)) return;
    out.push(child);
    walk(child.props.children as ReactNode);
  });
  walk(node);
  return out;
}

const textOf = (element: ReactElement<Record<string, unknown>>): string =>
  Children.toArray(element.props.children as ReactNode).map((child) => (
    typeof child === "string" ? child : isValidElement<Record<string, unknown>>(child) ? textOf(child) : ""
  )).join("");

function labelsOf(node: ReactNode): string[] {
  return elements(node).filter((element) => element.type === "button").map((element) => textOf(element).trim()).filter(Boolean);
}

function openRoom(group: Group) {
  fixture.groups = [group];
  fixture.portal = null;
  const onClose = vi.fn();
  const onMoveToSection = vi.fn();
  const onDelete = vi.fn();
  const onLeave = vi.fn();
  const html = renderToStaticMarkup(createElement(RoomContextMenu, {
    menu: { groupId: group.id, x: 20, y: 30 },
    onClose,
    onMoveToSection,
    onDelete,
    onLeave,
  }));
  const buttons = elements(fixture.portal).filter((element) => element.type === "button");
  return { html, labels: labelsOf(fixture.portal), buttons, onClose, onMoveToSection, onDelete, onLeave };
}

const click = (buttons: ReactElement<Record<string, unknown>>[], label: string) => {
  const button = buttons.find((element) => textOf(element).includes(label));
  if (!button) throw new Error(`no button ${label}`);
  (button.props.onClick as (event?: { preventDefault: () => void; stopPropagation: () => void }) => void)({
    preventDefault: () => {},
    stopPropagation: () => {},
  });
};

beforeEach(() => {
  fixture.portal = null;
  fixture.dispatch = vi.fn();
  fixture.groups = [];
  fixture.bots = [];
  fixture.config = { viewer: { principalId: "pr_me" } };
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  });
  writeSidebarHidden(DEFAULT_SIDEBAR_HIDDEN);
  vi.stubGlobal("document", { body: {}, documentElement: {} });
  vi.stubGlobal("window", {
    innerWidth: 1000,
    innerHeight: 800,
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: true }),
  });
  vi.stubGlobal("navigator", { language: "en", clipboard: { writeText: vi.fn() } });
});
afterEach(() => vi.unstubAllGlobals());

describe("memberMenuItems", () => {
  it("lists the person actions and adds Unpin only while the row is pinned", () => {
    expect(memberMenuItems({ peer: true, pinned: false })).toEqual([
      "viewProfile",
      "copyConversationId",
      "hide",
      "moveTo",
      "markUnread",
    ]);
    expect(memberMenuItems({ peer: true, pinned: true })).toEqual([
      "viewProfile",
      "copyConversationId",
      "hide",
      "unpin",
      "moveTo",
      "markUnread",
    ]);
    expect(memberMenuItems({ peer: false, pinned: true })).not.toContain("viewProfile");
  });
});

/** "Move to" lives inside MoveToSectionItem, so the static button walk
 * never sees it. The rendered markup does, in this order. */
function expectMenuOrder(html: string, labels: string[]) {
  let at = -1;
  for (const label of labels) {
    const next = html.indexOf(label, at + 1);
    expect(next, label).toBeGreaterThan(at);
    at = next;
  }
}

describe("person row menu", () => {
  const personLabels = (pinned: boolean) => [
    t("personPanel.view"),
    t("sidebar.copyConversationId"),
    t("sidebar.hidden.close"),
    ...(pinned ? [t("sidebar.bot.unpin")] : []),
    t("sidebar.bot.moveTo"),
    t("sidebar.bot.markUnread"),
  ];

  it("shows the member actions and not rename, delete or force-stop", () => {
    const open = openRoom(personRow(false));
    expect(open.html).toContain("data-member-menu");
    expectMenuOrder(open.html, personLabels(false));
    expect(open.html).toContain('aria-haspopup="menu"');
    expect(open.html).not.toContain(t("sidebar.room.renameChannel"));
    expect(open.html).not.toContain(t("sidebar.room.deleteChannel"));
    // one move, the submenu: never the room's section picker beside it
    expect(open.html.split(`>${t("sidebar.bot.moveTo")}<`).length).toBe(2);
    expect(open.html).not.toContain("Force stop");

    const pinned = openRoom(personRow(true));
    expectMenuOrder(pinned.html, personLabels(true));
    expect(pinned.html).toContain('aria-haspopup="menu"');
  });

  it("opens the profile, copies the people-DM thread, hides the person, unpins and marks unread", () => {
    const open = openRoom(personRow(true));
    click(open.buttons, t("personPanel.view"));
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "openPersonPanel", personId: "pr_morgan" });

    click(open.buttons, t("sidebar.copyConversationId"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("thread-morgan");

    click(open.buttons, t("sidebar.hidden.close"));
    expect(readSidebarHidden().items).toEqual([expect.objectContaining({ kind: "person", id: "pr_morgan" })]);
    expect(hiddenKey("person", "pr_morgan")).toBe("person:pr_morgan");

    click(open.buttons, t("sidebar.bot.unpin"));
    expect(fixture.dispatch).toHaveBeenCalledWith({
      type: "patchGroup",
      groupId: "dm-morgan",
      patch: { pinned: false },
    });

    click(open.buttons, t("sidebar.bot.markUnread"));
    expect(fixture.dispatch).toHaveBeenCalledWith({
      type: "patchGroup",
      groupId: "dm-morgan",
      patch: { unread: true },
    });
    expect(open.onDelete).not.toHaveBeenCalled();
    expect(open.onMoveToSection).not.toHaveBeenCalled();
    expect(open.onClose).toHaveBeenCalled();
  });

  it("leaves a room menu and a bot menu as they were", () => {
    const open = openRoom(room());
    expect(open.html).not.toContain("data-member-menu");
    expect(open.labels).not.toContain(t("personPanel.view"));
    expect(open.labels).not.toContain(t("sidebar.bot.markUnread"));
    expect(open.labels).not.toContain(t("sidebar.bot.unpin"));
    expect(open.labels).toContain(t("sidebar.section.moveToContext"));
    expect(open.labels).toContain(t("sidebar.room.renameChannel"));

    fixture.bots = [{
      id: "ara",
      threadId: "thread-ara",
      name: "Ara",
      title: "",
      description: "",
      notifications: true,
      color: "green",
      unread: false,
      pinned: true,
      messages: [],
      modelSelection: { instanceId: "test", model: "test" },
    }];
    fixture.portal = null;
    const html = renderToStaticMarkup(createElement(BotContextMenu, {
      menu: { botId: "ara", x: 10, y: 10 },
      onClose: vi.fn(),
      onArchive: vi.fn(),
      onDelete: vi.fn(),
      onMoveToSection: vi.fn(),
      onRename: vi.fn(),
    }));
    const labels = labelsOf(fixture.portal);
    expect(html).not.toContain("data-member-menu");
    expect(labels).toContain(t("sidebar.bot.unpin"));
    expect(labels).toContain(t("persona.menu.rename"));
    expect(labels).not.toContain("Rename Bot");
    expect(labels).not.toContain(t("personPanel.view"));
    // Move to › at the first level (owner, 2026-10-15); Mark as Unread left
    // the bot menu (0.5.7).
    expect(html).toContain(`>${t("sidebar.bot.moveTo")}<`);
    expect(html).toContain('aria-haspopup="menu"');
    expect(labels).not.toContain(t("sidebar.bot.markUnread"));
    // one flat menu: a single Move to, no More
    expect(html.split(`>${t("sidebar.bot.moveTo")}<`)).toHaveLength(2);
    expect(html).not.toContain('data-menu-item="more"');
  });

  it("hides rename, archive, delete and a server section move from a member who does not own the bot", () => {
    fixture.config = { viewer: { principalId: "pr_me", role: "member", operator: false } } as typeof fixture.config;
    fixture.bots = [{
      id: "ara",
      threadId: "thread-ara",
      name: "Ara",
      title: "",
      description: "",
      notifications: true,
      color: "green",
      unread: false,
      pinned: true,
      ownerUserId: "pr_owner",
      messages: [],
      modelSelection: { instanceId: "test", model: "test" },
    }];
    fixture.portal = null;
    const html = renderToStaticMarkup(createElement(BotContextMenu, {
      menu: { botId: "ara", x: 10, y: 10 },
      onClose: vi.fn(),
      onArchive: vi.fn(),
      onDelete: vi.fn(),
      onMoveToSection: vi.fn(),
      onRename: vi.fn(),
    }));
    const labels = labelsOf(fixture.portal);
    expect(labels).not.toContain(t("persona.menu.rename"));
    expect(html).not.toContain(t("sidebar.bot.archive"));
    expect(labels).toContain(t("sidebar.bot.unpin"));
    expect(html).not.toContain(`>${t("sidebar.bot.moveTo")}<`);
    expect(labels).toContain(t("sidebar.hidden.hide"));
    expect(html).not.toContain('data-menu-item="delete"');
  });
});

describe("Leave group in the room menu (#1480)", () => {
  const orgRoom = (ownerId: string, humanIds: string[]): Group => ({ ...room(), ownerId, humanIds });

  it("a member listed in the group leaves from the menu, which asks the caller to confirm", () => {
    const open = openRoom(orgRoom("pr_boss", ["pr_boss", "pr_me"]));
    expect(open.labels).toContain(t("groupPanel.leave"));
    click(open.buttons, t("groupPanel.leave"));
    expect(open.onLeave).toHaveBeenCalledWith("ops");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("the owner leaves too; someone listed only through a team, a solo server or a person row do not", () => {
    expect(openRoom(orgRoom("pr_me", ["pr_me", "pr_bob"])).labels).toContain(t("groupPanel.leave"));
    expect(openRoom(orgRoom("pr_boss", ["pr_boss", "team:ops"])).labels).not.toContain(t("groupPanel.leave"));
    expect(openRoom(room()).labels).not.toContain(t("groupPanel.leave"));
    expect(openRoom(personRow(false)).labels).not.toContain(t("groupPanel.leave"));
  });
});

describe("Leave vs Delete in the room menu (#2119)", () => {
  const orgRoom = (ownerId: string, humanIds: string[], memberIds: string[] = []): Group => ({
    ...room(),
    ownerId,
    humanIds,
    memberIds,
  });
  const deleteLabel = () => t("sidebar.room.deleteChannel");

  it("creator alone (bots do not count): Delete only, never Leave", () => {
    const open = openRoom(orgRoom("pr_me", ["pr_me"], ["bot-1"]));
    expect(open.labels).not.toContain(t("groupPanel.leave"));
    expect(open.labels).toContain(deleteLabel());
  });

  it("invited member: Leave only, never Delete", () => {
    const open = openRoom(orgRoom("pr_boss", ["pr_boss", "pr_me"]));
    expect(open.labels).toContain(t("groupPanel.leave"));
    expect(open.labels).not.toContain(deleteLabel());
  });

  it("creator with other people: Leave and Delete", () => {
    const open = openRoom(orgRoom("pr_me", ["pr_me", "pr_bob"]));
    expect(open.labels).toContain(t("groupPanel.leave"));
    expect(open.labels).toContain(deleteLabel());
  });
});
