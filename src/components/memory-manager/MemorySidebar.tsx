// Tools > Memory: the explorer of the Notes view, the Perspicax
// console's (notes-explorer.tsx, 2026-11-02): "Open a note" (Cmd+O, the
// quick switcher), LISTS (All notes, Teams, Pinned, Recent, Review and its
// dot), TIERS (each collapsible, its swatch and count, its folders hanging
// from a hairline; a bot is a folder of My memory with its Topics and Logs),
// then TIDY UP (Archived, Trash, Import). A row shows its actions (new note, new
// folder, rename, delete) on hover or focus, only the ones its source
// really supports. A folder says whether a bot is linked to it (the bot's
// look and "Linked to <bot>", or a plain folder and "Not linked"), and its
// ⋯ menu (a right click too) says what uses it and offers what it allows.
// Since 2026-11-03 (JC) it is the page's RIGHT rail, the same piece as
// Automations' calendar rail (RightRail.tsx): 280px, border on its left, the
// "›" fold button at its top-left, open from 1280px.
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import { RightRailPanel } from "@/components/RightRail";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { SECTION_LABEL, Swatch } from "./memory-ui";

export type MemoryRowActionKind = "new" | "newFolder" | "rename" | "delete";

export interface MemoryRowAction {
  kind: MemoryRowActionKind;
  label: string;
  onClick: () => void;
}

export interface MemorySidebarFolder {
  /** Stable key (a source id, or "<scope>/<folder>"); never shown. */
  key: string;
  name: string;
  /** Tooltip: the detail the row has no room for. */
  title?: string;
  icon: "bot" | "folder";
  count?: number;
  current: boolean;
  onOpen: () => void;
  actions: MemoryRowAction[];
  /** Nested folders (a bot's Topics and Logs). */
  children?: MemorySidebarFolder[];
  /** Data attributes the page's tests and gallery find the row by. */
  data?: Record<string, string>;
  /** Inline rename: the row turns into a field while it is renamed. */
  onRename?: (next: string) => void;
  /** Linked to a bot: its look in place of the folder icon. */
  leading?: ReactNode;
  /** No bot is linked to it: a plain folder and a muted "Not linked". */
  unlinked?: boolean;
  /** The ⋯ menu, also opened by a right click on the row. */
  menu?: MemoryFolderMenu;
}

export interface MemoryFolderMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  /** Set: the item shows, greyed, with this reason under it. */
  disabledReason?: string;
  danger?: boolean;
}

export interface MemoryFolderMenu {
  /** What the folder is used by, one line each. */
  lines: string[];
  items: MemoryFolderMenuItem[];
}

export interface MemorySidebarTier {
  key: string;
  name: string;
  title?: string;
  color: string;
  count: number;
  current: boolean;
  onOpen: () => void;
  actions: MemoryRowAction[];
  folders: MemorySidebarFolder[];
  data?: Record<string, string>;
}

export interface MemorySidebarNav {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Null: the list shows no count (the console's Recent). */
  count: number | null;
  current: boolean;
  onOpen: () => void;
  /** The orange dot of Review while something waits. */
  dot?: boolean;
}

const ACTION_ICON: Record<MemoryRowActionKind, LucideIcon> = {
  new: Plus,
  newFolder: FolderPlus,
  rename: Pencil,
  delete: Trash2,
};

const COUNT = "ml-auto shrink-0 pl-2 text-[11px] tabular-nums text-ink-tertiary";
const ROW = "group/row relative flex min-h-[30px] w-full min-w-0 items-center rounded-lg";
const SECTION = cn(SECTION_LABEL, "mx-2 mb-1.5 mt-4");

function RowActions({ actions, more, hint }: { actions: MemoryRowAction[]; more?: ReactNode; hint?: string }) {
  if (!actions.length && !more && !hint) return null;
  return (
    <span className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md bg-panel pl-1 group-focus-within/row:flex group-hover/row:flex has-[[aria-expanded=true]]:flex" data-memory-row-actions="">
      {hint && <span className="px-1 text-[11px] text-ink-tertiary" data-memory-unlinked="">{hint}</span>}
      {actions.map((action) => {
        const Icon = ACTION_ICON[action.kind];
        return (
          <button
            key={action.kind}
            type="button"
            aria-label={action.label}
            title={action.label}
            onClick={(event) => { event.stopPropagation(); action.onClick(); }}
            className={cn(
              "flex size-6 items-center justify-center rounded-md text-ink-secondary hover:bg-raised hover:text-ink",
              action.kind === "delete" && "hover:text-danger",
            )}
            data-memory-row-action={action.kind}
          >
            <Icon size={13} aria-hidden="true" />
          </button>
        );
      })}
      {more}
    </span>
  );
}

function FolderMenu({ name, menu, open, onOpenChange }: { name: string; menu: MemoryFolderMenu; open: boolean; onOpenChange: (open: boolean) => void }) {
  const box = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) onOpenChange(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onOpenChange(false); };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", key); };
  }, [open, onOpenChange]);
  return (
    <span ref={box} className="relative flex">
      <button
        type="button"
        aria-label={t("memoryManager.folderMenu", { folder: name })}
        title={t("memoryManager.folderMenu", { folder: name })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => { event.stopPropagation(); onOpenChange(!open); }}
        className="flex size-6 items-center justify-center rounded-md text-ink-secondary hover:bg-raised hover:text-ink"
        data-memory-row-action="menu"
      >
        <MoreHorizontal size={13} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label={name} className="absolute right-0 top-full z-40 mt-1 w-[220px] rounded-xl border-[0.5px] border-border bg-elevated p-1.5 text-left popover-surface" data-memory-folder-menu="">
          {menu.lines.map((line, index) => (
            <p key={index} className="px-2 py-1 text-[12px] leading-4 text-ink-secondary" data-memory-folder-menu-line="">{line}</p>
          ))}
          {menu.lines.length > 0 && menu.items.length > 0 && <div className="my-1 border-t border-hairline-weak" />}
          {menu.items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={Boolean(item.disabledReason)}
              title={item.disabledReason}
              onClick={(event) => { event.stopPropagation(); onOpenChange(false); item.onSelect(); }}
              className={cn(
                "flex w-full min-w-0 flex-col items-start rounded-md px-2 py-1.5 text-left text-[13px] disabled:cursor-not-allowed",
                item.disabledReason ? "text-ink-tertiary" : item.danger ? "text-danger hover:bg-danger/10" : "text-ink hover:bg-hover",
              )}
              data-memory-folder-menu-item={item.id}
            >
              <span className="flex items-center gap-2">{item.id === "delete" && <Trash2 size={13} aria-hidden="true" />}{item.label}</span>
              {item.disabledReason && <span className="mt-0.5 text-[11.5px] leading-4 text-ink-tertiary" data-memory-folder-menu-reason="">{item.disabledReason}</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function RenameField({ name, onSubmit, onCancel }: { name: string; onSubmit: (next: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(name);
  return (
    <input
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          const next = value.trim();
          if (next && next !== name) onSubmit(next);
          else onCancel();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={onCancel}
      aria-label={t("memoryManager.renameFolderField", { folder: name })}
      className="min-w-0 flex-1 rounded-md border border-border bg-ink/[0.03] px-2 py-1 text-[12.5px] text-ink outline-none focus:border-border-strong"
      data-memory-folder-rename=""
    />
  );
}

function FolderRow({ folder, depth, renaming, onRenameDone, opened, onToggle }: {
  folder: MemorySidebarFolder;
  depth: number;
  renaming: string | null;
  onRenameDone: () => void;
  opened: Set<string>;
  onToggle: (key: string) => void;
}) {
  const Icon = folder.icon === "bot" ? Bot : Folder;
  const [menuOpen, setMenuOpen] = useState(false);
  const hasChildren = Boolean(folder.children?.length);
  const childCurrent = Boolean(folder.children?.some((child) => child.current));
  const open = hasChildren && (folder.current || childCurrent || opened.has(folder.key));
  if (renaming === folder.key && folder.onRename) {
    return (
      <div className="flex items-center gap-2 py-1 pr-2" style={{ paddingLeft: 8 + depth * 18 }}>
        <Folder size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
        <RenameField name={folder.name} onSubmit={(next) => { onRenameDone(); folder.onRename?.(next); }} onCancel={onRenameDone} />
      </div>
    );
  }
  return (
    <>
      <div
        className={cn(ROW, folder.current ? "bg-selected" : "hover:bg-hover", menuOpen && "z-30")}
        style={{ paddingLeft: depth * 18 }}
        onContextMenu={folder.menu ? (event) => { event.preventDefault(); setMenuOpen(true); } : undefined}
        data-memory-folder-link={folder.unlinked ? "none" : folder.leading ? "bot" : undefined}
      >
        <button
          type="button"
          onClick={folder.onOpen}
          title={folder.title ?? folder.name}
          aria-current={folder.current ? "true" : undefined}
          className="flex min-h-[30px] min-w-0 flex-1 items-center gap-2 pl-2 pr-2 text-left"
          {...folder.data}
        >
          {folder.leading ?? <Icon size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />}
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{folder.name}</span>
          {folder.count != null && <span className={COUNT}>{folder.count}</span>}
        </button>
        {hasChildren && !folder.current && !childCurrent && (
          <button
            type="button"
            aria-label={open ? t("memoryManager.collapse", { name: folder.name }) : t("memoryManager.expand", { name: folder.name })}
            aria-expanded={open}
            onClick={() => onToggle(folder.key)}
            className="mr-1 flex size-5 shrink-0 items-center justify-center rounded text-ink-tertiary hover:text-ink"
          >
            {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
          </button>
        )}
        <RowActions actions={folder.actions} hint={folder.unlinked ? t("memoryManager.notLinked") : undefined} more={folder.menu ? <FolderMenu name={folder.name} menu={folder.menu} open={menuOpen} onOpenChange={setMenuOpen} /> : undefined} />
      </div>
      {open && folder.children?.map((child) => (
        <FolderRow key={child.key} folder={child} depth={depth + 1} renaming={renaming} onRenameDone={onRenameDone} opened={opened} onToggle={onToggle} />
      ))}
    </>
  );
}

function ListItem({ item }: { item: MemorySidebarNav }) {
  const Icon = item.icon;
  return (
    <li className="flex min-w-0">
      <button
        type="button"
        onClick={item.onOpen}
        aria-current={item.current ? "page" : undefined}
        className={cn("flex min-h-[30px] w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left", item.current ? "bg-selected font-medium" : "hover:bg-hover")}
        data-memory-nav={item.id}
      >
        <Icon size={16} className="shrink-0 text-ink-secondary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{item.label}</span>
        {item.dot && <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" data-memory-nav-dot="" />}
        {item.count != null && <span className={COUNT}>{item.count}</span>}
      </button>
    </li>
  );
}

export function MemorySidebar({ shortcut, onOpenSwitcher, switcher, lists, tiers, tidy, renaming, onRenameDone, loading, footer, onCollapse }: {
  /** "⌘O" on a Mac, "Ctrl+O" elsewhere. */
  shortcut: string;
  onOpenSwitcher: () => void;
  /** The quick switcher, drawn under its button while open. */
  switcher?: ReactNode;
  lists: MemorySidebarNav[];
  tiers: MemorySidebarTier[];
  tidy: MemorySidebarNav[];
  renaming: string | null;
  onRenameDone: () => void;
  loading: ReactNode;
  footer: ReactNode;
  /** Folds the rail into its strip, as Automations' calendar rail does. */
  onCollapse?: () => void;
}) {
  // A tier is unfolded unless the person folded it; a bot folder opens on demand.
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const flip = (setter: typeof setFolded) => (key: string) => setter((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const toggleTier = flip(setFolded);
  const toggleFolder = flip(setOpened);
  return (
    <RightRailPanel label={t("memoryManager.sidebarLabel")} onCollapse={onCollapse} hideLabel={t("memoryManager.explorerHide")} data-memory-sources="">
      <div className={cn("relative flex shrink-0 items-center gap-1 px-2", onCollapse ? "pt-1" : "pt-2.5")}>
        <button
          type="button"
          onClick={onOpenSwitcher}
          aria-keyshortcuts={shortcut === "⌘O" ? "Meta+O" : "Control+O"}
          title={`${t("memoryManager.openNote")} (${shortcut})`}
          className="flex h-[34px] min-w-0 flex-1 items-center gap-2 rounded-lg border border-hairline/60 bg-app px-2.5 text-left text-[13px] text-ink-secondary hover:text-ink"
          data-memory-switcher-open=""
        >
          <Search size={14} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{t("memoryManager.openNote")}</span>
          <kbd className="shrink-0 rounded border border-hairline/60 px-1 font-sans text-[11px] leading-4 text-ink-tertiary" aria-hidden="true">{shortcut}</kbd>
        </button>
        {switcher}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        <h3 className={cn(SECTION, "mt-2")}>{t("memoryManager.lists")}</h3>
        <ul className="flex flex-col gap-px" aria-label={t("memoryManager.viewsLabel")} data-memory-nav-list="">
          {lists.map((item) => <ListItem key={item.id} item={item} />)}
        </ul>
        {loading}
        {tiers.length > 0 && (
          <div data-memory-tiers="">
            <h3 className={SECTION}>{t("memoryManager.tiers")}</h3>
            <div role="tree" aria-label={t("memoryManager.tiers")}>
              {tiers.map((tier) => {
                const open = !folded.has(tier.key);
                return (
                  <section key={tier.key} className="mb-0.5" aria-label={tier.name} data-memory-tier-section={tier.key}>
                    <div className={cn(ROW, "pr-1", tier.current ? "bg-selected" : "hover:bg-hover")}>
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={open ? t("memoryManager.collapse", { name: tier.name }) : t("memoryManager.expand", { name: tier.name })}
                        onClick={() => toggleTier(tier.key)}
                        className="ml-0.5 grid h-6 w-5 shrink-0 place-items-center text-ink-tertiary hover:text-ink"
                        data-memory-tier-toggle={tier.key}
                      >
                        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                      </button>
                      <button
                        type="button"
                        onClick={tier.onOpen}
                        title={tier.title ?? tier.name}
                        aria-current={tier.current ? "true" : undefined}
                        className="flex min-h-[30px] min-w-0 flex-1 items-center gap-2 pl-0.5 pr-2 text-left"
                        {...tier.data}
                      >
                        <Swatch color={tier.color} />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{tier.name}</span>
                        <span className={COUNT}>{tier.count}</span>
                      </button>
                      <RowActions actions={tier.actions} />
                    </div>
                    {open && (
                      <div role="group" className="ml-[13px] border-l border-hairline-weak" data-memory-folders="">
                        {tier.folders.map((folder) => (
                          <FolderRow key={folder.key} folder={folder} depth={0} renaming={renaming} onRenameDone={onRenameDone} opened={opened} onToggle={toggleFolder} />
                        ))}
                        {tier.folders.length === 0 && (
                          <p className="py-1 pl-3 pr-2 text-[12px] text-ink-tertiary">{t("memoryManager.tierEmpty")}</p>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        )}
        {tidy.length > 0 && (
          <>
            <h3 className={SECTION}>{t("memoryManager.tidyUp")}</h3>
            <ul className="flex flex-col gap-px" data-memory-tidy-list="">
              {tidy.map((item) => <ListItem key={item.id} item={item} />)}
            </ul>
          </>
        )}
        {footer}
      </div>
    </RightRailPanel>
  );
}
