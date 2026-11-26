// The sidebar's bot menu, one flat menu (owner, 2026-10-15): New thread |
// Pin, Move to ›, Mark as Unread, New window | Rename, Edit bot, Make primary
// bot, Put on the desktop | Hide from sidebar, Archive, Delete. No More, and
// no New thread in a working folder, Mark all as read or Model…. Mark as
// Unread and New window came back with the reference's groups (owner,
// 2026-11-17, #4639). Copy link and Copy conversation ID left this menu
// (owner, 2026-11-25, #5373).
import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { setAdvancedMode } from "@/lib/interface-mode";

const fixture = vi.hoisted(() => ({
  portal: null as ReactNode,
  state: {} as Partial<AppState>,
  toggled: [] as string[],
  models: [] as string[],
  dispatched: [] as unknown[],
  copied: [] as string[],
}));
vi.mock("@/lib/copy-text", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/copy-text")>()),
  copyText: async (text: string) => { fixture.copied.push(text); return "copied"; },
}));
vi.mock("react-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-dom")>();
  return { ...original, createPortal: (node: ReactNode) => { fixture.portal = node; return node; } };
});
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => true }));
vi.mock("@/lib/floating-bots", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/floating-bots")>()),
  toggleFloatingBot: (id: string) => { fixture.toggled.push(id); return true; },
}));
vi.mock("@/lib/model-window", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/model-window")>()),
  openModelWindow: (id: string) => { fixture.models.push(id); },
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, ...fixture.state }, dispatch: (action: unknown) => { fixture.dispatched.push(action); } }) };
});

const { BotContextMenu } = await import("./Sidebar");

const bot = {
  id: "dumpling", threadId: "thread", name: "Dumpling", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId: "test", model: "test" },
} as unknown as Bot;

const handlers = () => ({
  onClose: vi.fn(),
  onRename: vi.fn(),
  onMakePrimary: vi.fn(),
  onEditPersona: vi.fn(),
  onArchive: vi.fn(),
  onDelete: vi.fn(),
});

function render(target: Bot = bot, props = handlers()) {
  fixture.state = { bots: [target, { ...bot, id: "other", name: "Other" } as Bot], ...fixture.state };
  const html = renderToStaticMarkup(createElement(BotContextMenu, { variant: "sidebar", menu: { botId: target.id, x: 10, y: 10 }, ...props }));
  return { html, props };
}

function items(html: string): string[] {
  return [...html.matchAll(/data-menu-item="([\w-]+)"/g)].map((match) => match[1]!);
}

/** The menu's buttons as React elements, by their data-menu-item. */
function buttons(): Map<string, ReactElement<{ onClick: () => void; disabled?: boolean }>> {
  const found = new Map<string, ReactElement<{ onClick: () => void; disabled?: boolean }>>();
  const walk = (node: ReactNode) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!isValidElement(node)) return;
    const props = node.props as { "data-menu-item"?: string; children?: ReactNode };
    if (props["data-menu-item"]) found.set(props["data-menu-item"], node as ReactElement<{ onClick: () => void; disabled?: boolean }>);
    walk(props.children);
  };
  walk(fixture.portal);
  return found;
}


beforeEach(() => {
  setLocale("en");
  fixture.state = {};
  fixture.toggled = [];
  fixture.models = [];
  fixture.dispatched = [];
  fixture.copied = [];
  fixture.portal = null;
  vi.stubGlobal("document", { body: {}, activeElement: null });
  vi.stubGlobal("window", { innerWidth: 1000, innerHeight: 800, addEventListener() {}, removeEventListener() {}, open: () => null });
});
afterEach(() => vi.unstubAllGlobals());

describe("the sidebar's bot menu", () => {
  it("lists every action in one menu, in Owner's order", () => {
    const { html } = render();
    // the maintainer, 2026-11-04: Archive all threads and Delete all threads, their own group
    expect(items(html)).toEqual(["new-thread", "pin", "move", "mark-unread", "new-window", "rename", "edit", "put-on-desktop", "archive-all-threads", "delete-all-threads", "hide", "archive", "delete"]);
    for (const label of [">New thread<", ">Pin<", ">Move to<", ">Rename the bot<", ">Edit bot<", ">Hide from sidebar<", ">Archive<"]) expect(html).toContain(label);
    expect(html).not.toContain("Rename Bot");
  });

  it("has no More page", () => {
    const { html } = render();
    expect(items(html)).not.toContain("more");
    expect(items(html)).not.toContain("back");
    expect(html).not.toContain(">More<");
    expect(html).not.toContain("data-bot-menu-page");
  });

  it("keeps the reference's groups in its order: Pin, Mark as Unread, New window | Hide, Delete", () => {
    const { html } = render();
    for (const label of [">Pin<", ">Mark as Unread<", ">New window<", ">Hide from sidebar<", ">Delete<"]) expect(html).toContain(label);
    const order = items(html);
    const pos = (id: string) => order.indexOf(id);
    expect(pos("pin")).toBeLessThan(pos("mark-unread"));
    expect(pos("mark-unread")).toBeLessThan(pos("new-window"));
    expect(pos("hide")).toBeLessThan(pos("delete"));
    // each group is set apart from the next by a divider
    expect(html).toMatch(/data-menu-item="new-window"[\s\S]*?class="menu-divider[\s\S]*?data-menu-item="rename"/);
    expect(html).toMatch(/data-menu-item="put-on-desktop"[\s\S]*?class="menu-divider[\s\S]*?data-menu-item="archive-all-threads"/);
  });

  it("has no Copy link and no Copy conversation ID row, and no empty group where they were (owner, 2026-11-25)", () => {
    for (const html of [render().html, render({ ...bot, unread: true }).html]) {
      expect(items(html)).not.toContain("copy-link");
      expect(items(html)).not.toContain("copy-id");
      expect(html).not.toContain("Copy link");
      expect(html).not.toContain("Copy conversation ID");
      // never two dividers in a row, nor one at either end of the menu
      expect(html).not.toMatch(/class="menu-divider[^>]*>(?:<\/div>)?\s*<div[^>]*class="menu-divider/);
    }
    // Put on the desktop, then one divider, then the next group
    const html = render().html;
    const between = html.slice(html.indexOf('data-menu-item="put-on-desktop"'), html.indexOf('data-menu-item="archive-all-threads"'));
    expect(between.match(/class="menu-divider/g)).toHaveLength(1);
  });

  it("Mark as Unread flags the bot", () => {
    render();
    const found = buttons();
    found.get("mark-unread")!.props.onClick();
    expect(fixture.dispatched).toContainEqual({ type: "markUnread", botId: bot.id });
    expect(found.has("copy-link")).toBe(false);
    expect(found.has("copy-id")).toBe(false);
    expect(fixture.copied).toEqual([]);
  });

  it("offers Mark as Read to a bot with unread messages", () => {
    const { html } = render({ ...bot, unread: true });
    expect(items(html)).toContain("mark-read");
    expect(items(html)).not.toContain("mark-unread");
    expect(html).toContain(">Mark as Read<");
  });

  it("hides New window where the surface cannot open a second window", () => {
    vi.stubGlobal("window", { innerWidth: 1000, innerHeight: 800, addEventListener() {}, removeEventListener() {} });
    expect(items(render().html)).not.toContain("new-window");
  });

  it("sets the groups apart: four separators, Delete last", () => {
    const { html } = render();
    // #4183: the menu family's divider (MenuDivider, menu-look.tsx)
    expect(html.match(/class="menu-divider /g)).toHaveLength(4);
    expect(items(html).at(-1)).toBe("delete");
  });

  it("offers Move to in Simple and Advanced mode alike", () => {
    expect(items(render().html)).toContain("move");
    setAdvancedMode(true);
    try {
      expect(items(render().html)).toContain("move");
    } finally {
      setAdvancedMode(false);
    }
  });

  it("keeps Delete in red, after Hide and Archive, and asks before deleting", () => {
    const { html, props } = render();
    expect(html).toMatch(/data-menu-item="delete"[^>]*class="[^"]*text-danger/);
    // Delete is its own component (BotDeleteMenuItem), keyed "delete".
    const nodes = fixture.portal as ReactElement<{ children: ReactNode[] }>;
    const flat = (nodes.props.children as ReactNode[]).flat() as ReactElement<{ onClick: () => void }>[];
    flat.find((node) => isValidElement(node) && node.key === "delete")!.props.onClick();
    expect(props.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: bot.id }));
  });

  it("Edit bot opens the bot editor, Rename renames", () => {
    const { props } = render();
    const found = buttons();
    found.get("edit")!.props.onClick();
    expect(props.onEditPersona).toHaveBeenCalledWith(expect.objectContaining({ id: bot.id }));
    found.get("rename")!.props.onClick();
    expect(props.onRename).toHaveBeenCalledWith(bot.id);
  });

  it("still does not offer Mark all as read, Model… or New thread in a working folder", () => {
    const html = render(bot, { ...handlers(), onNewInFolder: vi.fn() } as ReturnType<typeof handlers>).html;
    for (const id of ["mark-all-read", "model", "new-thread-folder"]) expect(items(html)).not.toContain(id);
    for (const label of [">Mark all conversations as read<", ">Model…<", ">New thread in a working folder…<"]) expect(html).not.toContain(label);
    expect(fixture.models).toEqual([]);
    expect(items(html)).toEqual(expect.arrayContaining(["rename", "edit"]));
  });


  it("says it in French, bot and not robot", () => {
    setLocale("fr");
    const main = render().html;
    for (const label of [">Nouveau fil<", ">Épingler<", ">Déplacer vers<", ">Renommer le bot<", ">Modifier le bot<", ">Mettre sur le bureau<", ">Masquer de la barre latérale<", ">Archiver<", ">Supprimer<"]) expect(main).toContain(label);
    for (const label of [">Marquer comme non lu<", ">Nouvelle fenêtre<"]) expect(main).toContain(label);
    for (const label of [">Copier le lien<", ">Copier l&#x27;ID de la conversation<"]) expect(main).not.toContain(label);
    for (const label of [">Tout marquer comme lu<", ">Modèle…<"]) expect(main).not.toContain(label);
    expect(main).not.toContain(">Plus<");
    expect(main).not.toContain("robot");
  });
});

describe("Share in the sidebar's bot menu", () => {
  const organization = { config: { viewer: { principalId: "member-1" } } } as unknown as Partial<AppState>;

  it("sits after Edit bot and opens the bot's Sharing page, for any member", () => {
    fixture.state = organization;
    const { html } = render();
    expect(items(html)).toEqual(["new-thread", "pin", "move", "mark-unread", "new-window", "rename", "edit", "share", "put-on-desktop", "archive-all-threads", "delete-all-threads", "hide", "archive", "delete"]);
    expect(html).toContain(">Share<");
    buttons().get("share")!.props.onClick();
    expect(fixture.dispatched).toEqual([{ type: "toggleSettings", open: true, botId: bot.id, section: "sharing" }]);
  });

  it("says Partager in French", () => {
    setLocale("fr");
    fixture.state = organization;
    expect(render().html).toContain(">Partager<");
  });

  it("is absent where no organization can share", () => {
    expect(items(render().html)).not.toContain("share");
  });

  it("is in both menus: the right-click and the ... button open the same BotContextMenu", () => {
    const source = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
    const row = source.slice(source.indexOf("const onContextMenu = (event: React.MouseEvent) => {"));
    expect(row.slice(0, 200)).toContain("openBotContextMenu(onMenu, bot.id, event)");
    expect(row).toMatch(/aria-haspopup="menu" onClick=\{\(event\) => \{[^}]*onMenu\(\{ botId: bot\.id/);
    // one menu component builds the entries for both
    expect(source.match(/data-menu-item/g)?.length).toBeGreaterThan(0);
    expect(source).toContain('t("sidebar.bot.share")');
  });
});
