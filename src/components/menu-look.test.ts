// @vitest-environment happy-dom
// #4183: the header's conversation menu and the rows' and cards' three dots
// menus take the reference's menu values through the one menu surface and
// row the account menu draws (#4157, src/components/menu-look.tsx), with no
// second copy of the values anywhere else.
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadMenu } from "./ThreadMenu";
import { COMPOSER_ANCHOR_INSET, COMPOSER_POPOVER_GAP, COMPOSER_POPOVER_RISE, MENU_ROW, MENU_ROW_ACTIVE, MENU_ROW_DANGER, MENU_SURFACE, SUBMENU_SIDE_OFFSET, useMenuInWindow, type MenuPoint } from "./menu-look";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  document.documentElement.dataset.reducedMotion = "true";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

const classes = (node: Element | null) => (node?.getAttribute("class") ?? "").split(/\s+/);
const SURFACE = ["menu-surface", "popover-surface", "rounded-2xl", "p-1.5", "gap-0.5", "text-[14px]", "leading-5"];
const ROW = ["h-8", "rounded-[10px]", "px-2", "gap-1.5", "text-[14px]", "leading-5", "hover:bg-menu-hover"];

describe("the menu family's one look", () => {
  it("holds the account menu's measured values", () => {
    expect(MENU_SURFACE.split(" ")).toEqual(expect.arrayContaining(SURFACE));
    expect(MENU_ROW.split(" ")).toEqual(expect.arrayContaining([...ROW, "text-ink"]));
    expect(MENU_ROW_DANGER.split(" ")).toEqual(expect.arrayContaining([...ROW, "text-danger"]));
    expect(MENU_ROW_ACTIVE.split(" ")).toEqual(expect.arrayContaining(["bg-menu-active", "h-8", "rounded-[10px]"]));
    expect(SUBMENU_SIDE_OFFSET).toBe(-4);
  });
});

describe("the header's conversation menu (ThreadMenu)", () => {
  it("draws the menu family's surface, rows, glyphs and dividers", () => {
    act(() => root.render(createElement(ThreadMenu, {
      task: { threadId: "t1", title: "Weekly report" },
      actions: { onRename: vi.fn(), onDelete: vi.fn(), onPin: vi.fn(), onArchive: vi.fn() },
      position: { left: 10, top: 10 },
      onClose: () => {},
      tone: "popover",
    })));
    const menu = document.querySelector('[role="menu"]');
    expect(classes(menu)).toEqual(expect.arrayContaining(SURFACE));
    for (const old of ["rounded-lg", "border", "shadow-xl", "bg-card", "bg-popover", "border-popover-hairline", "p-1"]) expect(classes(menu)).not.toContain(old);
    const rename = document.querySelector('[data-thread-menu-item="rename"]');
    expect(classes(rename)).toEqual(expect.arrayContaining(ROW));
    for (const old of ["text-[12px]", "py-2", "px-2.5", "hover:bg-raised"]) expect(classes(rename)).not.toContain(old);
    expect(rename?.querySelector("[data-menu-glyph]")?.classList.contains("menu-glyph")).toBe(true);
    // its labels are never cut: the menu sizes to them, as the account menu
    // does, over a 228px floor (a French "Déplacer vers un dossier" fits)
    expect(classes(menu)).toEqual(expect.arrayContaining(["w-max", "min-w-[min(228px,calc(100vw-16px))]", "max-w-[min(400px,calc(100vw-16px))]"]));
    expect(classes(menu)).not.toContain("w-[228px]");
    const remove = document.querySelector('[data-thread-menu-item="delete"]');
    expect(classes(remove)).toEqual(expect.arrayContaining(["text-danger", "hover:bg-menu-hover"]));
    const dividers = document.querySelectorAll('[role="menu"] [role="separator"]');
    expect(dividers.length).toBeGreaterThan(0);
    for (const divider of dividers) expect(classes(divider)).toContain("menu-divider");
  });
});

/** Every source file of the renderer. */
function sources(dir = "src"): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("the rows' and cards' three dots menus", () => {
  // The menus #4183 moved onto the shared look: each takes it from
  // menu-look.tsx, directly or through its own shared row constant.
  const ROW_MENUS = [
    "src/components/ThreadMenu.tsx",
    "src/components/SidebarPopoverMenu.tsx",
    "src/components/BotProjects.tsx",
    "src/components/Sidebar.tsx",
    "src/components/Sidebar.tsx-parts/SectionPicker.tsx",
    "src/components/Sidebar.tsx-parts/SidebarOverlays.tsx",
    "src/components/Sidebar.tsx-parts/TeamMenuItems.tsx",
    "src/components/OrgSectionMenu.tsx",
    "src/components/bot-settings/BotActionsMenu.tsx",
    "src/components/bot-settings/BotTaskSection.tsx",
    "src/components/bot-settings/CodeBranchList.tsx",
    "src/components/bot-settings/ComputerCard.tsx",
    "src/components/bot-settings/FilesSection.tsx",
    "src/components/bot-settings/WorkspaceFilesSection.tsx",
    "src/components/bot-settings/WorkspaceFilesSection.tsx-parts/menus.tsx",
    "src/components/code/CloudAgentsCard.tsx",
    "src/components/code/RunView.tsx",
    "src/components/computer/ComputerMoreMenu.tsx",
    "src/components/computer/OrgComputerTab.tsx",
    "src/components/content-page.tsx",
    "src/components/dev-pods/DevMenu.tsx",
    "src/components/ExportTranscriptMenu.tsx",
    "src/components/GoalRunCard.tsx",
    "src/components/memory-manager/MemoryNoteView.tsx",
    "src/components/memory-manager/MemorySidebar.tsx",
    "src/components/MessageHoverActions.tsx",
    "src/components/OutboundCard.tsx",
    "src/components/plugins/InstalledView.tsx",
    "src/components/routines/RoutineFolders.tsx",
    "src/components/routines/RoutineRowMenu.tsx",
    "src/components/settings/OrgSharing.tsx",
    "src/components/ThreadLinkMenu.tsx",
    "src/components/ChatFileLink.tsx",
    "src/components/memory-manager/MemoryNotesList.tsx",
    "src/components/plugins/SkillPage.tsx",
    "src/components/memory-manager/MemoryManagerPanel.tsx",
    "src/components/team-map/TeamMenu.tsx",
    "src/components/VoiceCallCard.tsx",
    "src/components/BrowserPanel.tsx-parts/LiveBrowserView.tsx",
    "src/components/RoutineCalendarPage.tsx",
    "src/components/RoutineToggleLine.tsx",
    "src/components/approvals/ApprovalsPage.tsx",
    "src/components/settings/OwnAvatarField.tsx",
    "src/components/settings/AccountCard.tsx",
    "src/components/TeamMapPage.tsx",
    "src/components/bot-profile/BotProfilePage.tsx-parts/AddMenu.tsx",
    "src/components/data/DataPanel.tsx",
    "src/components/GotoGroupChip.tsx",
    "src/components/LimitResetContinue.tsx",
    "src/components/RolePicker.tsx",
    "src/components/ApprovalModeSelector.tsx",
    "src/components/remote-session/ComputerTableRow.tsx",
  ];

  it.each(ROW_MENUS)("%s takes the shared menu look", (file) => {
    const text = readFileSync(file, "utf8");
    // a fixed width cuts a longer (French) label: the menus size to it
    expect(text).not.toMatch(/MENU_SURFACE, "(?:[^"]* )?w-\[2[0-9]{2}px\]/);
    // the old card surface: its own outline and heavy shadow
    expect(text).not.toMatch(/rounded-lg border border-hairline\/50 bg-card p-1 shadow-xl/);
    expect(text).toMatch(/from "(\.\/|\.\.\/|@\/components\/)menu-look"/);
    // the old surfaces: a card or popover fill with its own outline and shadow
    expect(text).not.toMatch(/rounded-(lg|xl) border(-\[0\.5px\])? border-(hairline\/50|border|popover-border|hairline\/60) (popover-surface )?bg-(card|elevated|popover|raised) p-1/);
    // the old rows: 12 or 13px type on their own grey hover
    expect(text).not.toMatch(/rounded(-md|-lg)? px-(2|2\.5|3) py-(1\.5|2) text-left text-\[1[23](\.5)?px\][^"]*hover:bg-(hover|raised)/);
    // the other old surfaces the review found: a 12px elevated box, a
    // 12px panel box, a small card box, and their own rows
    expect(text).not.toMatch(/rounded-\[12px\][^"]*p-1\.5/);
    expect(text).not.toMatch(/rounded-xl border border-hairline popover-surface bg-panel/);
    expect(text).not.toMatch(/rounded-lg border border-hairline\/50 bg-card p-1 shadow-lg/);
    expect(text).not.toMatch(/rounded-lg px-3 py-2\.5 text-left text-\[12px\]/);
    expect(text).not.toMatch(/rounded px-2 py-1 text-left text-\[12\.5px\][^"]*hover:bg-raised/);
    // a row's leading icon sits in the shared glyph slot, not its own span
    expect(text).not.toMatch(/<span className="shrink-0 text-ink-secondary">\{icon\}<\/span>/);
    // a page menu sizes to its labels too
    expect(text).not.toMatch(/PAGE_MENU, "w-\[2[0-9]{2}px\]/);
    // a submenu's own offset (8px away, 6px above its row) instead of
    // SUBMENU_SIDE_OFFSET, and a fixed width that cuts a longer label
    expect(text).not.toMatch(/top-\[-6px\]/);
    expect(text).not.toMatch(/MENU_SURFACE, "[^"]*\b(?:min-)?w-(?:44|52|56|64)\b/);
    // a menu's own floor under 228px (a field's min-w is not a menu)
    expect(text).not.toMatch(/MENU_(?:SURFACE|FIT(?:_ROW)?)[^"]{0,180}min-w-\[(?:1[0-4][0-9]|180|200|220)px\]/);
    expect(text).not.toMatch(/"[^"]*(?:absolute|fixed)[^"]*min-w-\[(?:1[0-4][0-9]|180|200|220)px\][^"]*"/);
    expect(text).not.toMatch(/"[^"]*min-w-\[(?:1[0-4][0-9]|180|200|220)px\][^"]*(?:absolute|fixed)[^"]*"/);
    expect(text).not.toMatch(/"min-w-\[(?:1[0-4][0-9]|180|200|220)px\]"/);
  });

  // The three dots menus on rows and cards that drew their own box: each
  // menu's box is the shared surface, sized to its labels.
  it.each([
    "src/components/GoalRunCard.tsx",
    "src/components/MessageHoverActions.tsx",
    "src/components/team-map/TeamMenu.tsx",
    "src/components/VoiceCallCard.tsx",
  ])("%s draws its menu on MENU_SURFACE with menu rows", (file) => {
    const text = readFileSync(file, "utf8");
    expect(text).toMatch(/cn\(\s*(POPUP_PLACE,\s*)?MENU_SURFACE,\s*MENU_FIT(_ROW)?\b/);
    expect(text).toMatch(/\b(MENU_ROW|menuRow\()/);
    expect(text).toMatch(/\b(MenuGlyph|menu-glyph)\b/);
  });

  it("writes the menu's values once, in menu-look.tsx", () => {
    const copies = sources().filter((file) => {
      const text = readFileSync(file, "utf8");
      return /popover-surface menu-surface p-1\.5/.test(text) || /h-8 w-full shrink-0 items-center gap-1\.5 rounded-\[10px\]/.test(text);
    });
    expect(copies.map((file) => file.split(sep).join("/"))).toEqual(["src/components/menu-look.tsx"]);
  });
});

describe("the composer and its popovers share the menu family's edge", () => {
  // The + menu, the mode and model menus, the "/" and "@" lists and the
  // memes picker wear the shared box; the composer's field and the cards
  // pinned above it draw `menu-edge` (the same hairline and shadow tokens).
  const POPOVERS = [
    "src/components/ComposerControls.tsx",
    "src/components/ApprovalModeSelector.tsx",
    "src/components/ModelMenu.tsx",
    "src/components/ModelPicker.tsx",
    "src/components/ModelPicker.tsx-parts/ModelPickerMenu.tsx",
    "src/components/ComposerCommandMenu.tsx",
    "src/components/Composer.tsx-parts/ComposerMentionMenu.tsx",
    "src/components/MemePicker.tsx",
  ];
  it.each(POPOVERS)("%s draws its popover on the shared look", (file) => {
    const text = readFileSync(file, "utf8");
    expect(text).toMatch(/from "(\.\/|\.\.\/)menu-look"/);
    expect(text).toMatch(/\bMENU_(SURFACE|BOX)\b/);
    // no outline or heavy shadow of its own on the popover's box
    expect(text).not.toMatch(/border(-\[0\.5px\])? border-(popover-hairline|border|hairline\/40)[^"]*(popover-surface|bg-popover|bg-raised|bg-elevated)/);
    expect(text).not.toMatch(/shadow-2xl shadow-black\/50/);
    expect(text).not.toMatch(/rounded-xl border border-hairline\/40 bg-raised shadow-lg/);
  });
  it("every composer popover keeps the account menu's 4px gap above the capsule", () => {
    expect(COMPOSER_POPOVER_GAP).toBe(4);
    expect(COMPOSER_POPOVER_RISE).toBe(COMPOSER_POPOVER_GAP + COMPOSER_ANCHOR_INSET);
    for (const file of ["src/components/ComposerControls.tsx", "src/components/ModelPicker.tsx", "src/components/ModelPicker.tsx-parts/ModelPickerMenu.tsx"]) {
      const text = readFileSync(file, "utf8");
      expect(text).toContain("COMPOSER_POPOVER_RISE_CLASS");
      expect(text).not.toMatch(/bottom-full[^"]*\bmb-(?:1\.5|2)\b/);
    }
    for (const file of ["src/components/ComposerCommandMenu.tsx", "src/components/Composer.tsx-parts/ComposerMentionMenu.tsx"]) {
      expect(readFileSync(file, "utf8")).toContain("COMPOSER_LIST_RISE_CLASS");
    }
    expect(readFileSync("src/components/ApprovalModeSelector.tsx", "utf8")).toContain("gap={COMPOSER_POPOVER_RISE}");
    expect(readFileSync("src/components/MemePicker.tsx", "utf8")).toContain("gap: COMPOSER_POPOVER_RISE");
  });
  it("the + menu's rows are the menu rows", () => {
    const text = readFileSync("src/components/ComposerControls.tsx", "utf8");
    expect(text).not.toContain("h-[30px]");
    expect(text).not.toContain('role="separator" className="mx-2 my-1');
  });
  it.each([
    "src/components/Composer.tsx-parts/ComposerEditor.tsx",
    "src/components/task/TaskComposer.tsx",
    "src/components/coding/CodingChat.tsx",
    "src/components/Composer.tsx-parts/PinnedWaitingCard.tsx",
    "src/components/PendingApproval.tsx",
  ])("%s draws the menu edge, not its own outline", (file) => {
    const text = readFileSync(file, "utf8");
    expect(text).toContain("menu-edge");
    expect(text).not.toMatch(/bg-composer[^"]*(?:ring-composer-ring|shadow-\[0_2px_8px)/);
    expect(text).not.toMatch(/border-\[0\.5px\] border-border bg-composer/);
  });
  it("menu-edge and menu-surface read the same two tokens", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const rule = (name: string) => css.slice(css.indexOf(`  .${name} {`), css.indexOf("}", css.indexOf(`  .${name} {`)));
    for (const name of ["menu-surface", "menu-edge"]) {
      expect(rule(name)).toContain("border: 0.5px solid var(--menu-hairline)");
      expect(rule(name)).toContain("box-shadow: var(--menu-shadow)");
    }
  });
  it("high contrast strengthens the shared edge", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const start = css.indexOf(':root[data-contrast="high"]:not(#a11y)');
    expect(css.slice(start, css.indexOf("}", start))).toContain("--menu-hairline: color-mix(in srgb, var(--color-ink) 55%");
  });
});

describe("a menu sized to its content stays in the window", () => {
  // The menus size to their labels (MENU_FIT_ROW, 228px up to 400px). Placed
  // with a guessed 228 to 260px width, a menu opened near the right edge (the
  // bot panel's "...") with a long host or folder name or a French label ran
  // past the window and its text was cut. Each one now places itself with
  // its measured size through useMenuInWindow.
  const width = 360;
  const height = 200;
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { width: "menu" in this.dataset ? width : 0, height: "menu" in this.dataset ? height : 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    vi.stubGlobal("innerWidth", 1000);
    vi.stubGlobal("innerHeight", 700);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function Menu({ at }: { at: MenuPoint }) {
    const ref = useRef<HTMLDivElement>(null);
    useMenuInWindow(ref, at);
    return createElement("div", { ref, "data-menu": "", style: { position: "fixed", left: at.left, top: at.top } });
  }
  const place = (at: MenuPoint) => {
    act(() => root.render(createElement(Menu, { at })));
    const menu = container.querySelector<HTMLElement>("[data-menu]")!;
    return { left: parseFloat(menu.style.left), top: parseFloat(menu.style.top) };
  };

  it("keeps a wide menu opened at the right edge inside the window, 8px in", () => {
    const { left, top } = place({ left: 900, top: 650 });
    expect(left + width).toBe(1000 - 8);
    expect(top + height).toBe(700 - 8);
  });

  it("puts a menu under a \"...\" with its right edge on the trigger's", () => {
    expect(place({ left: 980, top: 40, right: true })).toEqual({ left: 980 - width, top: 40 });
  });

  it("leaves a menu that fits where it was asked", () => {
    expect(place({ left: 100, top: 100 })).toEqual({ left: 100, top: 100 });
  });

  it("the conversation menu places itself with its measured size", () => {
    act(() => root.render(createElement(ThreadMenu, { task: { threadId: "t1", title: "A conversation" }, position: { left: 900, top: 40 }, onClose: () => {}, actions: { onRename: () => {}, onDelete: () => {} } })));
    const menu = document.querySelector<HTMLElement>("[data-thread-menu]")!;
    menu.dataset.menu = "";
    act(() => root.render(createElement(ThreadMenu, { task: { threadId: "t1", title: "A conversation" }, position: { left: 900, top: 41 }, onClose: () => {}, actions: { onRename: () => {}, onDelete: () => {} } })));
    expect(parseFloat(menu.style.left) + width).toBeLessThanOrEqual(1000 - 8);
  });

  it("no menu places itself with a guessed width any more", () => {
    const guessed = sources().filter((file) => /window\.innerWidth - (2[0-9]{2}|1[5-9][0-9])\b|rect\.right - 2[0-9]{2}\b/.test(readFileSync(file, "utf8")));
    expect(guessed).toEqual([]);
  });
});
