// The one thread menu (owner, 2026-10-14): the sidebar's thread rows and the
// header's All threads picker share it. One menu, no More (owner,
// 2026-10-15), in the reference design's short sections (owner, 2026-10-16): Rename,
// Regenerate title, Pin, Move › | Archive, Snooze › | Copy link, Remove
// link | Delete.
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { ThreadMenuItems, type ThreadMenuActions, type ThreadMenuPage } from "./ThreadMenu";
import { pickerRowActions } from "./TaskPicker";

afterEach(() => setLocale("en"));

const task = { threadId: "t1", title: "Weekly report" };
const folders = [{ id: "work", name: "Research" }, { id: "home", name: "Home", emoji: "🏠" }];

const allActions = (): ThreadMenuActions & Record<string, ReturnType<typeof vi.fn>> => ({
  onRename: vi.fn(), onDelete: vi.fn(), onPin: vi.fn(), onArchive: vi.fn(), onSnooze: vi.fn(), onMove: vi.fn(),
  onCopyLink: vi.fn(), onRegenerateTitle: vi.fn(), onRemoveLink: vi.fn(),
});

type Props = Parameters<typeof ThreadMenuItems>[0];
const props = (over: Partial<Props> = {}): Props => ({
  task, actions: allActions(), folders, page: "main", onPage: vi.fn(), onClose: vi.fn(),
  regenerating: false, onRegenerate: vi.fn(), advanced: true, ...over,
});
const markup = (over: Partial<Props> = {}) => renderToStaticMarkup(createElement(ThreadMenuItems, props(over)));
const ids = (html: string) => [...html.matchAll(/data-thread-menu-item="([\w-]+)"/g)].map((match) => match[1]);

/** The page's items as React elements, by their id (the Item component's
 * props, or a plain button's data attribute). */
function items(given: Props): Map<string, { onClick: () => void; disabled?: boolean }> {
  const found = new Map<string, { onClick: () => void; disabled?: boolean }>();
  const walk = (node: ReactNode) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!isValidElement(node)) return;
    const element = node.props as { id?: string; "data-thread-menu-item"?: string; onClick?: () => void; disabled?: boolean; children?: ReactNode };
    const id = element["data-thread-menu-item"] ?? (typeof node.type === "function" ? element.id : undefined);
    if (id && element.onClick) found.set(id, { onClick: element.onClick, disabled: element.disabled });
    walk(element.children);
  };
  walk(ThreadMenuItems(given));
  return found;
}

describe("the thread menu", () => {
  it("lists every action in one menu, Delete last, and no More", () => {
    expect(ids(markup({ task: { ...task, link: "https://example.com/pr/1" } }))).toEqual(["rename", "regenerate", "pin", "move", "archive", "snooze", "copy-link", "remove-link", "delete"]);
    const html = markup();
    for (const label of ["Rename thread", "Pin", "Archive", "Snooze", "Copy link", "Delete thread"]) expect(html).toContain(label);
    expect(html).not.toContain(">More<");
    expect(ids(html)).not.toContain("more");
    // nothing about another thread or a new one
    expect(html).not.toContain("New thread");
    expect(html).not.toContain("New folder");
  });

  it("drops what the owner does not offer", () => {
    const given = props({ actions: { onRename: vi.fn(), onDelete: vi.fn() } });
    expect(ids(renderToStaticMarkup(createElement(ThreadMenuItems, given)))).toEqual(["rename", "delete"]);
  });

  it("groups the usual sidebar thread: Rename, Pin | Archive, Snooze | Copy link | Delete in red", () => {
    const { onMove: _move, onRegenerateTitle: _regenerate, onRemoveLink: _remove, ...actions } = allActions();
    const html = markup({ actions, folders: [] });
    expect(ids(html)).toEqual(["rename", "pin", "archive", "snooze", "copy-link", "delete"]);
    expect(html).toMatch(/data-thread-menu-item="delete"[^>]*class="[^"]*text-danger/);
    // a separator before Archive, Copy link and Delete
    expect(html.match(/role="separator"/g)).toHaveLength(3);
    const order = html.split('role="separator"').map((part) => ids(part));
    expect(order).toEqual([["rename", "pin"], ["archive", "snooze"], ["copy-link"], ["delete"]]);
  });

  it("draws no divider around an empty section", () => {
    const html = markup({ actions: { onRename: vi.fn(), onDelete: vi.fn() } });
    expect(html.match(/role="separator"/g)).toHaveLength(1);
  });

  it("offers no Refresh permissions: a conversation runs at its bot's level (#4200)", () => {
    expect(ids(markup({ advanced: true }))).not.toContain("refresh-permissions");
  });

  it("offers Remove link only on a linked thread", () => {
    expect(ids(markup())).not.toContain("remove-link");
  });

  it("snoozes in one step down, and offers the way back for a snoozed thread", () => {
    expect(ids(markup({ page: "snooze" }))).toEqual(["back", "snooze-activity", "snooze-tonight", "snooze-tomorrow"]);
    expect(ids(markup({ page: "snooze", task: { ...task, snoozedUntil: 0 } }))).toEqual(["back", "stop-snooze", "snooze-activity", "snooze-tonight", "snooze-tomorrow"]);
    const given = props({ page: "snooze" });
    items(given).get("snooze-activity")!.onClick();
    expect(given.actions.onSnooze).toHaveBeenCalledWith(0);
    expect(given.onClose).toHaveBeenCalledOnce();
  });

  it("moves into a folder from a real list, with the current one checked", () => {
    const html = markup({ page: "move", task: { ...task, projectId: "work" } });
    expect(ids(html)).toEqual(["back", "folder-work", "folder-home", "folder-none"]);
    expect(html).not.toContain("<select");
    const given = props({ page: "move", task: { ...task, projectId: "work" } });
    items(given).get("folder-home")!.onClick();
    expect(given.actions.onMove).toHaveBeenCalledWith("home");
    items(given).get("folder-none")!.onClick();
    expect(given.actions.onMove).toHaveBeenLastCalledWith(null);
  });

  it("opens a page without closing, and runs an action then closes", () => {
    const given = props();
    const found = items(given);
    found.get("snooze")!.onClick();
    expect(given.onPage).toHaveBeenCalledWith("snooze" satisfies ThreadMenuPage);
    expect(given.onClose).not.toHaveBeenCalled();
    found.get("archive")!.onClick();
    expect(given.actions.onArchive).toHaveBeenCalledWith(expect.any(Number));
    expect(given.onClose).toHaveBeenCalledOnce();
  });

  it("offers Unarchive for an archived thread and greys the busy actions while it works", () => {
    expect(markup({ task: { ...task, archivedAt: 0 } })).toContain("Unarchive");
    const busy = props({ task: { ...task, activity: "working" } });
    expect(items(busy).get("delete")!.disabled).toBe(true);
  });

  it("shows Regenerating… while the title request runs", () => {
    const html = markup({ regenerating: true });
    expect(html).toContain("Regenerating…");
    expect(html).toContain('aria-busy="true"');
  });

  it("says it in French", () => {
    setLocale("fr");
    const html = markup();
    expect(html).toContain("Renommer le fil");
    expect(html).toContain("Supprimer le fil");
    expect(html).not.toContain(">Plus<");
    expect(markup({ task: { ...task, link: "https://example.com" } })).toContain("Retirer le lien");
  });
});

describe("the All threads picker's row menu", () => {
  it("is the same menu: the picker's callbacks become the thread's actions", () => {
    const onDelete = vi.fn();
    const onPin = vi.fn();
    const onMove = vi.fn();
    const threadActions = { onCopyLink: vi.fn(), onArchive: vi.fn(), onSnooze: vi.fn() };
    const actions = pickerRowActions(task, { onRename: vi.fn(), onDelete, onPin, onMove, threadActions });
    actions.onDelete();
    actions.onPin!(true);
    actions.onMove!("work");
    actions.onArchive!(5);
    actions.onSnooze!(0);
    actions.onCopyLink!();
    expect(onDelete).toHaveBeenCalledWith("t1");
    expect(onPin).toHaveBeenCalledWith("t1", true);
    expect(onMove).toHaveBeenCalledWith("t1", "work");
    expect(threadActions.onArchive).toHaveBeenCalledWith("t1", 5);
    expect(threadActions.onSnooze).toHaveBeenCalledWith("t1", 0);
    expect(threadActions.onCopyLink).toHaveBeenCalledWith("t1");
    expect(actions.onRegenerateTitle).toBeUndefined();
    expect(ids(renderToStaticMarkup(createElement(ThreadMenuItems, props({ actions }))))).toEqual(["rename", "pin", "move", "archive", "snooze", "copy-link", "delete"]);
  });
});

describe("Open beside (side thread)", () => {
  it("comes first when the owner offers it, and runs then closes", () => {
    const onOpenAside = vi.fn();
    const onClose = vi.fn();
    const given = props({ actions: { ...allActions(), onOpenAside }, onClose });
    const html = renderToStaticMarkup(createElement(ThreadMenuItems, given));
    expect(ids(html)[0]).toBe("open-aside");
    expect(html).toContain("Open beside");
    items(given).get("open-aside")!.onClick();
    expect(onOpenAside).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalled();
  });

  it("is absent where the owner does not offer it (rooms, the thread on screen)", () => {
    expect(ids(markup())).not.toContain("open-aside");
  });

  it("reads Ouvrir à côté in French", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(ThreadMenuItems, props({ actions: { ...allActions(), onOpenAside: vi.fn() } })));
    expect(html).toContain("Ouvrir à côté");
  });
});
