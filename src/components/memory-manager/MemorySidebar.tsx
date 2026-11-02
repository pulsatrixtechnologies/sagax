// Tools > Memory: the page's left column (2026-11-02), drawn like the
// Perspicax console's notes explorer: a search field (Cmd+O), the views with
// their counts, then TIERS, each tier collapsible with its folder rows. A row
// shows its actions (new note, new folder, rename, delete) on hover or focus,
// only the ones its source really supports.
import { useState, type ReactNode, type RefObject } from "react";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

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
  icon: "bot" | "folder" | "brain";
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
}

export interface MemorySidebarTier {
  key: string;
  name: string;
  title?: string;
  dot: "success" | "accent" | "muted";
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
  count: number;
  current: boolean;
  onOpen: () => void;
}

const ACTION_ICON: Record<MemoryRowActionKind, LucideIcon> = {
  new: Plus,
  newFolder: FolderPlus,
  rename: Pencil,
  delete: Trash2,
};

const DOT: Record<MemorySidebarTier["dot"], string> = {
  success: "bg-success",
  accent: "bg-accent",
  muted: "bg-ink-tertiary",
};

const COUNT = "ml-auto shrink-0 pl-2 text-[11px] tabular-nums text-ink-tertiary";
const ROW = "group/row relative flex w-full min-w-0 items-center rounded-lg";

function RowActions({ actions }: { actions: MemoryRowAction[] }) {
  if (!actions.length) return null;
  return (
    <span className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md bg-panel pl-1 group-focus-within/row:flex group-hover/row:flex" data-memory-row-actions="">
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

function FolderRow({ folder, depth, renaming, onRenameDone, collapsed, onToggle }: {
  folder: MemorySidebarFolder;
  depth: number;
  renaming: string | null;
  onRenameDone: () => void;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
}) {
  const Icon = folder.icon === "bot" ? FileText : folder.icon === "brain" ? Brain : Folder;
  const hasChildren = Boolean(folder.children?.length);
  // A folder with children opens on demand (the set holds "open:<key>"), and always while it is the one shown.
  const open = hasChildren && (folder.current || collapsed.has(`open:${folder.key}`));
  if (renaming === folder.key && folder.onRename) {
    return (
      <div className="flex items-center gap-2 py-1 pr-3" style={{ paddingLeft: depth * 16 + 24 }}>
        <Folder size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
        <RenameField name={folder.name} onSubmit={(next) => { onRenameDone(); folder.onRename?.(next); }} onCancel={onRenameDone} />
      </div>
    );
  }
  return (
    <>
      <div className={cn(ROW, folder.current ? "bg-selected" : "hover:bg-raised")} style={{ paddingLeft: depth * 16 + 4 }}>
        {/* the chevron's slot: every row keeps it, so icons line up */}
        <span className="flex w-4 shrink-0 justify-center">
          {hasChildren && !folder.current && (
            <button
              type="button"
              aria-label={open ? t("memoryManager.collapse", { name: folder.name }) : t("memoryManager.expand", { name: folder.name })}
              aria-expanded={open}
              onClick={() => onToggle(`open:${folder.key}`)}
              className="flex size-4 items-center justify-center text-ink-tertiary hover:text-ink"
            >
              {open ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
            </button>
          )}
        </span>
        <button
          type="button"
          onClick={folder.onOpen}
          title={folder.title}
          aria-current={folder.current ? "true" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-1 pr-3 text-left"
          {...folder.data}
        >
          <Icon size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{folder.name}</span>
          {folder.count != null && <span className={COUNT}>{folder.count}</span>}
        </button>
        <RowActions actions={folder.actions} />
      </div>
      {open && folder.children?.map((child) => (
        <FolderRow key={child.key} folder={child} depth={depth + 1} renaming={renaming} onRenameDone={onRenameDone} collapsed={collapsed} onToggle={onToggle} />
      ))}
    </>
  );
}

export function MemorySidebar({ query, onQuery, searchRef, shortcut, nav, tiers, renaming, onRenameDone, loading, footer }: {
  query: string;
  onQuery: (next: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  /** "⌘O" on a Mac, "Ctrl+O" elsewhere. */
  shortcut: string;
  nav: MemorySidebarNav[];
  tiers: MemorySidebarTier[];
  renaming: string | null;
  onRenameDone: () => void;
  loading: ReactNode;
  footer: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  return (
    <aside aria-label={t("memoryManager.sidebarLabel")} className="flex h-full w-[280px] shrink-0 flex-col overflow-hidden border-r border-hairline/40 bg-panel" data-memory-sources="">
      <div className="shrink-0 px-3 pb-2 pt-3">
        <label className="flex h-9 min-w-0 items-center gap-1.5 rounded-lg border border-hairline/50 bg-app px-2.5 text-ink focus-within:ring-2 focus-within:ring-accent/60">
          <Search size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); onQuery(""); } }}
            placeholder={t("memoryManager.openNote")}
            aria-label={t("memoryManager.openNote")}
            aria-keyshortcuts={shortcut === "⌘O" ? "Meta+O" : "Control+O"}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-tertiary [&::-webkit-search-cancel-button]:hidden"
            data-memory-search=""
          />
          {query ? (
            <button type="button" onClick={() => onQuery("")} aria-label={t("memoryManager.clearSearch")} className="shrink-0 text-ink-tertiary hover:text-ink">
              <X size={13} aria-hidden="true" />
            </button>
          ) : (
            <kbd className="shrink-0 rounded border border-hairline/50 px-1 font-sans text-[11px] leading-4 text-ink-tertiary" aria-hidden="true">{shortcut}</kbd>
          )}
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <nav aria-label={t("memoryManager.viewsLabel")} className="space-y-0.5" data-memory-nav-list="">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={item.onOpen}
                aria-current={item.current ? "page" : undefined}
                className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left", item.current ? "bg-selected" : "hover:bg-raised")}
                data-memory-nav={item.id}
              >
                <Icon size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{item.label}</span>
                <span className={COUNT}>{item.count}</span>
              </button>
            );
          })}
        </nav>
        {loading}
        {tiers.length > 0 && (
          <div className="mt-3 border-t border-hairline/40 pt-3" data-memory-tiers="">
            <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{t("memoryManager.tiers")}</p>
            {tiers.map((tier) => {
              const open = !collapsed.has(tier.key);
              return (
                <section key={tier.key} className="mb-1" aria-label={tier.name} data-memory-tier-section={tier.key}>
                  <div className={cn(ROW, tier.current ? "bg-selected" : "hover:bg-raised")}>
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={open ? t("memoryManager.collapse", { name: tier.name }) : t("memoryManager.expand", { name: tier.name })}
                      onClick={() => toggle(tier.key)}
                      className="flex h-8 w-6 shrink-0 items-center justify-end text-ink-tertiary hover:text-ink"
                      data-memory-tier-toggle={tier.key}
                    >
                      {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      onClick={tier.onOpen}
                      title={tier.title}
                      aria-current={tier.current ? "true" : undefined}
                      className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-1.5 pr-3 text-left"
                      {...tier.data}
                    >
                      <span className={cn("size-2 shrink-0 rounded-full", DOT[tier.dot])} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{tier.name}</span>
                      <span className={COUNT}>{tier.count}</span>
                    </button>
                    <RowActions actions={tier.actions} />
                  </div>
                  {open && (
                    <div className="mt-0.5 space-y-0.5" data-memory-folders="">
                      {tier.folders.map((folder) => (
                        <FolderRow key={folder.key} folder={folder} depth={1} renaming={renaming} onRenameDone={onRenameDone} collapsed={collapsed} onToggle={toggle} />
                      ))}
                      {tier.folders.length === 0 && (
                        <p className="py-1 pl-7 pr-3 text-[12px] text-ink-tertiary">{t("memoryManager.tierEmpty")}</p>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
        {footer}
      </div>
    </aside>
  );
}
