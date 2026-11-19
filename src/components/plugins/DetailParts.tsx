// The pieces every detail page of Connect apps shares (a plugin, a vendor
// bundle, a skill, a connector), so they read as one family (#4453, the
// owner's "detail premium feel"; the shape of the Customize page of the
// Claude desktop app): the header (an icon tile, ONE name, a "New" badge
// when the item is new, one grey source line, the main action at the right),
// the Overview's two columns (the description in comfortable type, the
// categories, "Connectors & tools" at the right), the Skills cards, the
// Connectors rows, the quiet Details block, and Contents: a file tree and the
// selected file read from what the server already lists and reads.
import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ChevronRight, Download, FileText, Folder, FolderOpen, Info, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { dateFieldLocale, t } from "@/lib/i18n";
import { api } from "@/state/store";
import { readableError } from "@/lib/plain-error";
import { ChatMarkdown, CodeBlock } from "../ChatMarkdown";
import { Switch } from "../SettingsPrimitives";
import { PluginIcon, GlyphTile } from "./PluginParts";
import { SEGMENT_GROUP, segmentOptionClass } from "./ScopeToggle";
import { StateIcon, type RowState } from "./StateIcon";
import { PLUGINS } from "./plugins-style";
import { BookOpen } from "lucide-react";
import type { PluginItem } from "@/lib/plugins-model";

/** The one line under a name: "from <source> · 1.2.0 · 3 skills" (a part that
 * is not known is not drawn). */
export function sourceLine(parts: ReadonlyArray<string | null | undefined | false>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

/** The body of every detail page (plugin, bundle, skill, connector): one
 * left and right edge, one 20px rhythm between the header, the tabs and the sections. */
export const DETAIL_BODY = "min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-8 pt-1 sm:px-[34px]";

/** One fact of a section: the label, then its value right beside it (the
 * Details block's pairs), never the value pushed to the far edge. */
export function FactRows({ children, attrs }: { children: ReactNode; attrs?: Record<`data-${string}`, string | undefined> }) {
  return <dl className="grid grid-cols-[minmax(88px,max-content)_minmax(0,1fr)] gap-x-4 text-[13px] leading-5" {...attrs}>{children}</dl>;
}
export function FactRow({ label, children, title, attrs }: { label: string; children: ReactNode; title?: string; attrs?: Record<`data-${string}`, string | undefined> }) {
  return (
    <div className="contents" {...attrs}>
      <dt className="py-[7px] text-ink-tertiary">{label}</dt>
      <dd className="min-w-0 break-words py-[7px] text-ink" title={title}>{children}</dd>
    </div>
  );
}

/** A header action (Update, Publish, Delete): one height and one inset on every detail page. */
export const HEADER_ACTION = "h-[26px] px-3";

/** The header of a detail page: the tile, the name (once), a small "New"
 * badge when the item is new, one grey line, the main action at the right. */
export function DetailHeader({ icon, name, line, isNew = false, actions, attrs }: {
  icon: ReactNode;
  name: string;
  line?: string;
  /** only when it is known the item is new */
  isNew?: boolean;
  actions?: ReactNode;
  attrs?: Record<`data-${string}`, string | undefined>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3" data-plugins-detail-head {...attrs}>
      {icon}
      <div className="min-w-0 flex-[1_1_220px] pl-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[18px] font-normal leading-7 tracking-[-0.005em] text-ink" data-plugins-detail-name>{name}</h2>
          {isNew && <span data-detail-new="" className="shrink-0 rounded-full bg-accent/15 px-2 text-[12px] leading-5 text-accent-text">{t("connectApps.detail.new")}</span>}
        </div>
        {line && <p className="truncate text-[13px] leading-5 text-ink-secondary" data-plugins-detail-meta title={line}>{line}</p>}
      </div>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A grey label over a block of the Overview. */
export function DetailLabel({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-[13px] font-normal leading-5 text-ink-secondary">{children}</h3>;
}

/** The categories as small outlined chips. */
export function CategoryChips({ categories }: { categories: readonly string[] }) {
  if (categories.length === 0) return null;
  return (
    <section data-detail-categories="">
      <DetailLabel>{t("connectApps.detail.categories")}</DetailLabel>
      <ul className="flex flex-wrap gap-1.5">
        {categories.map((category) => (
          <li key={category} className="rounded-full border-[0.5px] border-ink/20 px-2.5 py-0.5 text-[12px] leading-4 text-ink-secondary">{category}</li>
        ))}
      </ul>
    </section>
  );
}

/** The panel at the right of the Overview: "Can send data to other services"
 * (only when it is known to be true), then each connector with its mark. */
export function ReachPanel({ network, rows }: {
  network: boolean;
  rows: ReadonlyArray<{ key: string; name: string; icon: ReactNode; state?: RowState | null }>;
}) {
  if (rows.length === 0) return null;
  return (
    <aside className="self-start rounded-[14px] border-[0.5px] border-ink/[0.1] p-3.5" data-detail-reach="">
      <h3 className="mb-2 text-[13px] font-normal leading-5 text-ink-secondary">{t("connectApps.detail.reach")}</h3>
      {network && (
        <p className="mb-2 flex items-center gap-1.5 text-[13px] leading-5 text-ink" data-detail-network="">
          {t("connectApps.detail.sendsData")}
          <span title={t("connectApps.detail.sendsDataTip")} aria-label={t("connectApps.detail.sendsDataTip")} role="img" className="inline-flex text-ink-tertiary"><Info size={14} aria-hidden="true" /></span>
        </p>
      )}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2 text-[13px] leading-[18px] text-ink">
            {row.icon}
            <span className="min-w-0 flex-1 truncate" title={row.name}>{row.name}</span>
            {row.state && <StateIcon state={row.state} />}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** The Overview: the description and the categories on the left, the panel at
 * the right, one column under the width a panel needs. */
export function OverviewColumns({ description, categories = [], reach, children, beneath }: {
  description?: string;
  categories?: readonly string[];
  reach?: ReactNode;
  children?: ReactNode;
  /** under the categories (the update waiting) */
  beneath?: ReactNode;
}) {
  const left = Boolean(description) || categories.length > 0 || Boolean(children) || Boolean(beneath);
  if (!left && !reach) return null;
  return (
    <div className={cn("grid gap-x-8 gap-y-5", reach && left && "md:grid-cols-[minmax(0,1fr)_minmax(220px,300px)]")} data-detail-overview="">
      {left && (
        <div className="min-w-0 space-y-5">
          {description && (
            <section data-detail-description="">
              <DetailLabel>{t("connectApps.detail.about")}</DetailLabel>
              <p className="whitespace-pre-line break-words text-[14px] leading-[22px] text-ink">{description}</p>
            </section>
          )}
          <CategoryChips categories={categories} />
          {beneath}
          {children}
        </div>
      )}
      {reach}
    </div>
  );
}

/** The last update an item had, in one calm line under the same "Update" label (its version history): when, from and to. No notes, no banner. */
export function LastUpdateNote({ at, from, to }: { at: number; from?: string; to?: string }) {
  const date = new Date(at).toLocaleDateString(dateFieldLocale(), { year: "numeric", month: "long", day: "numeric" });
  return (
    <section data-detail-last-update="">
      <DetailLabel>{t("connectApps.updates.versions")}</DetailLabel>
      <p className="text-[13px] leading-5 text-ink">{from && to ? t("connectApps.updates.lastUpdateFromTo", { date, from, to }) : t("connectApps.updates.lastUpdate", { date })}</p>
    </section>
  );
}

/** The update waiting, said in the Overview (the header holds its one button): the versions and what changes. */
export function UpdateNote({ from, to, notes }: { from?: string; to?: string; notes?: string }) {
  const versions = [from, to].filter(Boolean).join(" \u2192 ") || t("connectApps.plugin.newerFiles");
  return (
    <section data-detail-update="">
      <DetailLabel>{t("connectApps.updates.versions")}</DetailLabel>
      <p className="text-[13px] leading-5 text-ink">{versions}</p>
      {notes && (
        <>
          <p className="mt-3 text-[12px] leading-4 text-ink-tertiary">{t("connectApps.updates.notes")}</p>
          <p className="mt-0.5 whitespace-pre-line break-words text-[13px] leading-5 text-ink-secondary" data-detail-update-notes="">{notes}</p>
        </>
      )}
    </section>
  );
}

/** The Skills tab: one grey line, then a card per skill (its mark, "/name", one line). */
export function SkillCards({ skills }: { skills: ReadonlyArray<{ name: string; description: string; onOpen?: () => void }> }) {
  return (
    <div role="tabpanel" data-plugin-detail-panel="skills" className="space-y-3">
      <p className={PLUGINS.rowSub}>{t("connectApps.detail.skillsLine")}</p>
      <ul className="grid gap-2 md:grid-cols-2">
        {skills.map((skill) => (
          <li key={skill.name}>
            {(() => {
              const face = (
                <>
                  <GlyphTile glyph={BookOpen} className="size-10" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium leading-[18px] text-ink">/{skill.name}</span>
                    {skill.description && <span className="block truncate text-[12px] leading-4 text-ink-secondary" title={skill.description}>{skill.description}</span>}
                  </span>
                </>
              );
              const box = "flex w-full min-w-0 items-center gap-3 rounded-2xl border-[0.5px] border-ink/[0.1] p-3 text-left";
              return skill.onOpen
                ? <button type="button" onClick={skill.onOpen} className={cn(box, "transition-colors hover:bg-ink/[0.04] motion-reduce:transition-none")}>{face}</button>
                : <div className={box}>{face}</div>;
            })()}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What a connector row of a plugin says of its state, in words, and what fixes it. */
export type ConnectorWord = "connected" | "needsSignIn" | "pending" | "notAdded";

/** The Connectors tab: one grey line, then rows between thin rules: the mark,
 * the name, its state in words and the action that fixes it. */
export function ConnectorRows({ connectors, line = t("connectApps.detail.connectorsLine") }: {
  line?: string;
  connectors: ReadonlyArray<{ key: string; name: string; item: Pick<PluginItem, "kind" | "name" | "logo" | "domain"> & { key?: string }; /** absent: its state is not known here, none is said */ word?: ConnectorWord; onOpen?: () => void }>;
}) {
  const label: Record<ConnectorWord, string> = {
    connected: t("connectApps.status.connected"),
    needsSignIn: t("connectApps.status.needsAuth"),
    pending: t("connectApps.status.pending"),
    notAdded: t("connectApps.detail.notAdded"),
  };
  return (
    <div role="tabpanel" data-plugin-detail-panel="connectors" className="space-y-1">
      <p className={cn(PLUGINS.rowSub, "mb-2")}>{line}</p>
      <ul className="flex flex-col divide-y divide-hairline-weak">
        {connectors.map((connector) => (
          <li key={connector.key} className="flex items-center gap-3 py-3" data-detail-connector={connector.word ?? "unknown"}>
            {(() => {
              const face = (
                <>
                  <PluginIcon item={connector.item} className="size-10 rounded-[10px]" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-[18px] text-ink" title={connector.name}>{connector.name}</span>
                </>
              );
              return connector.onOpen
                ? <button type="button" onClick={connector.onOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left">{face}</button>
                : <span className="flex min-w-0 flex-1 items-center gap-3">{face}</span>;
            })()}
            {connector.word && <span className={cn("shrink-0 text-[12px] leading-4", connector.word === "connected" ? "text-ink-tertiary" : connector.word === "notAdded" ? "text-ink-secondary" : "text-warning")}>{label[connector.word]}</span>}
            {connector.word && connector.word !== "connected" && connector.word !== "pending" && connector.onOpen && (
              <button type="button" onClick={connector.onOpen} data-detail-connector-fix="" className={cn(PLUGINS.fillPill, "h-7 px-3 text-[12px]")}>
                {connector.word === "needsSignIn" ? t("mcp.oauth.signIn") : t("connectApps.detail.addIt")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The quiet Details block at the bottom of an Overview: the facts as rows,
 * the update waiting (with its button), and a switch when the page has one. */
export function DetailsBlock({ rows, update, enabled, busy = false }: {
  rows: ReadonlyArray<{ label: string; value: string; mono?: boolean }>;
  update?: { onUpdate: () => void; updating?: boolean };
  enabled?: { value: boolean; onToggle: () => void; label: string };
  busy?: boolean;
}) {
  return (
    <section data-plugin-details-block="" className="border-t-[0.5px] border-ink/10 pt-4">
      <h3 className="mb-1 text-[12px] leading-4 text-ink-secondary">{t("connectApps.detail.details")}</h3>
      {/* a compact list: pairs, label then value close together, two columns of pairs at this width; only ids are monospace */}
      <dl className="grid gap-x-8 text-[12px] leading-4 md:grid-cols-2" data-plugin-details>
        {rows.map((row) => (
          <div key={row.label} className={cn("flex min-w-0 gap-3 py-1.5", row.value.length > 56 && "md:col-span-2")}>
            <dt className="w-[88px] shrink-0 text-ink-tertiary">{row.label}</dt>
            <dd className={cn("min-w-0 flex-1 break-words text-ink-secondary", row.mono && "font-mono text-[12px]")}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {update && (
        <div className="flex min-h-[38px] items-center justify-between gap-3 border-t-[0.5px] border-ink/10 py-1.5" data-plugin-update-row>
          <span className="text-[13px] text-ink-secondary">{t("connectApps.plugin.updateAvailable")}</span>
          <button type="button" disabled={busy || update.updating} onClick={update.onUpdate} data-plugin-action="update-details" className={cn(PLUGINS.fillPill, "h-7 px-3.5 text-[13px]")}>
            {update.updating ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
            {t("connectApps.plugin.update")}
          </button>
        </div>
      )}
      {enabled && (
        <label className="flex min-h-[38px] items-center justify-between gap-3 border-t-[0.5px] border-ink/10 py-1.5 text-[13px] text-ink-secondary" data-plugin-enabled>
          {t("connectApps.detail.enabled")}
          <Switch checked={enabled.value} disabled={busy} onClick={enabled.onToggle} aria-label={enabled.label} />
        </label>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- Contents */

export interface TreeFile { path: string; bytes?: number; kind?: "text" | "image" | "pdf" | "other" }
interface TreeNode { name: string; path: string; dir: boolean; file?: TreeFile; children: TreeNode[] }

/** The files as folders (folders first, then by name). */
export function buildTree(files: readonly TreeFile[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", dir: true, children: [] };
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let at = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      const last = index === parts.length - 1;
      let next = at.children.find((child) => child.name === part && child.dir === !last);
      if (!next) {
        next = { name: part, path, dir: !last, ...(last ? { file } : {}), children: [] };
        at.children.push(next);
      }
      at = next;
    });
  }
  const order = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    for (const node of nodes) order(node.children);
  };
  order(root.children);
  return root.children;
}

/** The file read first: a README, else a SKILL.md, else the first file. */
export function firstFile(files: readonly TreeFile[]): string | null {
  const names = files.map((file) => file.path);
  return names.find((name) => /^readme(\.md)?$/i.test(name))
    ?? names.find((name) => name === "SKILL.md")
    ?? [...files].sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path))[0]?.path
    ?? null;
}

const LANGUAGE: Record<string, string> = { sh: "bash", yml: "yaml", md: "markdown", mjs: "javascript", cjs: "javascript", js: "javascript", jsx: "jsx", ts: "typescript", tsx: "tsx", py: "python", rb: "ruby", rs: "rust", json: "json", toml: "toml", html: "html", css: "css", xml: "xml", go: "go" };
const languageOf = (path: string) => LANGUAGE[path.split(".").pop()?.toLowerCase() ?? ""] ?? "text";
/** A markdown file's text without its front matter (the `---` block a SKILL.md or agent starts with), for the rendered view; Source shows all of it. */
export const withoutFrontMatter = (text: string): string => text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "").replace(/^\s+/, "");
/** What a README may load when it is read here: an https image (the app's image policy); any other image (http, a relative or a local
 * path) is shown as its link or its words, never fetched or read. */
export function markdownForReading(text: string): string {
  return text.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?([^)]*)\)/g, (whole, alt: string, url: string) => {
    if (/^https:\/\//i.test(url)) return whole;
    if (/^http:\/\//i.test(url)) return `[${alt || url}](${url})`;
    return alt || "";
  });
}
const isMarkdown = (path: string) => /\.(md|markdown)$/i.test(path);

/** The tree keys: Up and Down move through the visible rows, Right opens a folder (then goes in), Left folds it (then goes out), Home and End,
 * Enter and Space choose; one row is in the tab order (roving). */
function TreeRows({ nodes, depth, open, onToggle, selected, onSelect, focused, onFocus, parentPath }: {
  nodes: TreeNode[]; depth: number; open: ReadonlySet<string>; onToggle: (path: string) => void; selected: string | null; onSelect: (path: string) => void;
  focused: string | null; onFocus: (path: string) => void; parentPath?: string;
}) {
  return (
    <ul role={depth === 0 ? "tree" : "group"} aria-label={depth === 0 ? t("connectApps.files.aria") : undefined}>
      {nodes.map((node) => {
        const expanded = open.has(node.path);
        const move = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
          const tree = event.currentTarget.closest('[role="tree"]');
          const rows = tree ? Array.from(tree.querySelectorAll<HTMLButtonElement>("[data-file-row]")) : [];
          const at = rows.indexOf(event.currentTarget);
          const go = (target: HTMLButtonElement | undefined) => { if (target) { event.preventDefault(); onFocus(target.getAttribute("data-file-row")!); target.focus(); } };
          if (event.key === "ArrowDown") go(rows[at + 1]);
          else if (event.key === "ArrowUp") go(rows[at - 1]);
          else if (event.key === "Home") go(rows[0]);
          else if (event.key === "End") go(rows[rows.length - 1]);
          else if (event.key === "ArrowRight" && node.dir) { event.preventDefault(); if (!expanded) onToggle(node.path); else go(rows[at + 1]); }
          else if (event.key === "ArrowLeft") {
            event.preventDefault();
            if (node.dir && expanded) onToggle(node.path);
            else if (parentPath) go(rows.find((row) => row.getAttribute("data-file-row") === parentPath));
          }
        };
        return (
          <li key={node.path} role="treeitem" aria-expanded={node.dir ? expanded : undefined} aria-selected={!node.dir ? selected === node.path : undefined}>
            <button type="button" data-file-row={node.path} data-file-dir={node.dir ? "" : undefined}
              tabIndex={(focused ?? selected ?? "") === node.path ? 0 : -1}
              onFocus={() => onFocus(node.path)}
              onKeyDown={move}
              onClick={() => (node.dir ? onToggle(node.path) : onSelect(node.path))}
              style={{ paddingLeft: 8 + depth * 14 }}
              className={cn("flex h-7 w-full min-w-0 items-center gap-1.5 rounded-lg pr-2 text-left text-[13px] leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong motion-reduce:transition-none",
                !node.dir && selected === node.path ? "bg-ink/[0.08] text-ink" : "text-ink-secondary hover:bg-ink/[0.05] hover:text-ink")}>
              {node.dir ? <ChevronRight size={13} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform motion-reduce:transition-none", expanded && "rotate-90")} /> : <span aria-hidden="true" className="w-[13px] shrink-0" />}
              {node.dir ? (expanded ? <FolderOpen size={14} aria-hidden="true" className="shrink-0" /> : <Folder size={14} aria-hidden="true" className="shrink-0" />) : <FileText size={14} aria-hidden="true" className="shrink-0" />}
              <span className="min-w-0 flex-1 truncate" title={node.name}>{node.name}</span>
            </button>
            {node.dir && expanded && <TreeRows nodes={node.children} depth={depth + 1} open={open} onToggle={onToggle} selected={selected} onSelect={onSelect} focused={focused} onFocus={onFocus} parentPath={node.path} />}
          </li>
        );
      })}
    </ul>
  );
}

/** Contents: a quiet pill (the item and its version), a box with the file
 * tree at the left (folders fold) and the selected file at the right (a
 * README as formatted text with a Rendered | Source switch, code as a styled
 * block). `listUrl` is the server's read-only list of the item's files;
 * `?path=` reads one. `extra` are files the list leaves out (a skill's SKILL.md). */
export function FileExplorer({ listUrl, extra = [], pill, onDownload }: {
  listUrl: string;
  extra?: readonly TreeFile[];
  /** "<name> <version> · current", quiet, above the box */
  pill?: ReactNode;
  /** only when the app can already export the item */
  onDownload?: () => void;
}) {
  const [files, setFiles] = useState<TreeFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [text, setText] = useState<{ path: string; value: string } | { path: string; error: string } | null>(null);
  const [source, setSource] = useState(false);
  const [focusedRow, setFocusedRow] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setFiles(null);
    setError(null);
    api(listUrl).then((answer: { files?: TreeFile[] }) => {
      if (!alive) return;
      const listed = [...extra.filter((file) => !(answer.files ?? []).some((other) => other.path === file.path)), ...(answer.files ?? [])];
      setFiles(listed);
      const first = firstFile(listed);
      setSelected(first);
      if (first) setOpen(new Set(first.split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/"))));
    }).catch((cause: unknown) => { if (alive) setError(readableError(cause)); });
    return () => { alive = false; };
    // the list is read once per item
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listUrl]);
  const tree = useMemo(() => buildTree(files ?? []), [files]);
  const file = files?.find((entry) => entry.path === selected);
  useEffect(() => {
    if (!selected || !file) return;
    if (file.kind && file.kind !== "text") return;
    let alive = true;
    setText(null);
    api(`${listUrl}?path=${encodeURIComponent(selected)}`)
      .then((answer: { text?: string }) => { if (alive) setText({ path: selected, value: typeof answer.text === "string" ? answer.text : "" }); })
      .catch((cause: unknown) => { if (alive) setText({ path: selected, error: readableError(cause) }); });
    return () => { alive = false; };
  }, [selected, file, listUrl]);
  useEffect(() => setSource(false), [selected]);
  const toggle = (path: string) => setOpen((current) => { const next = new Set(current); if (!next.delete(path)) next.add(path); return next; });
  const readable = file && (!file.kind || file.kind === "text");
  const loaded = text && text.path === selected ? text : null;
  return (
    <div role="tabpanel" data-plugin-detail-panel="contents" className="space-y-3">
      {(pill || onDownload) && (
        <div className="flex items-center justify-between gap-3">
          {pill}
          {onDownload && (
            <button type="button" onClick={onDownload} data-contents-download="" aria-label={t("connectApps.files.download")} title={t("connectApps.files.download")} className="ui-icon-button ml-auto">
              <Download size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {error ? (
        <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>
      ) : files === null ? (
        <div className="flex items-center gap-2 py-6 text-[13px] text-ink-secondary"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> {t("connectApps.files.loading")}</div>
      ) : files.length === 0 ? (
        <p className="py-6 text-[13px] text-ink-secondary">{t("connectApps.files.empty")}</p>
      ) : (
        <div className="grid min-h-[320px] overflow-hidden rounded-[14px] border-[0.5px] border-ink/[0.1] md:grid-cols-[minmax(180px,250px)_minmax(0,1fr)]" data-file-explorer="">
          <div className="max-h-[440px] overflow-y-auto border-b-[0.5px] border-ink/[0.1] p-1.5 md:max-h-[520px] md:border-b-0 md:border-r-[0.5px]">
            <TreeRows nodes={tree} depth={0} open={open} onToggle={toggle} selected={selected} onSelect={setSelected} focused={focusedRow} onFocus={setFocusedRow} />
          </div>
          <div className="min-w-0 max-h-[520px] overflow-y-auto" data-file-viewer={selected ?? ""}>
            {selected ? (
              <>
                <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-ink/[0.1] px-3.5 py-2">
                  <span className="min-w-0 truncate font-mono text-[12px] leading-5 text-ink-secondary" title={selected}>{selected}</span>
                  {readable && isMarkdown(selected) && loaded && "value" in loaded && (
                    <div role="radiogroup" aria-label={selected} className={SEGMENT_GROUP} data-file-switch="">
                      {([false, true] as const).map((mode) => (
                        <button key={String(mode)} type="button" role="radio" aria-checked={source === mode} onClick={() => setSource(mode)} className={segmentOptionClass(source === mode, false, true)}>
                          {t(mode ? "connectApps.files.source" : "connectApps.files.rendered")}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="px-3.5 py-3">
                  {!readable ? (
                    <p className="text-[13px] text-ink-secondary" data-file-note="binary">{t("connectApps.files.binary")}</p>
                  ) : !loaded ? (
                    <div className="flex items-center gap-2 text-[13px] text-ink-secondary"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> {t("connectApps.files.loading")}</div>
                  ) : "error" in loaded ? (
                    <p role="alert" className="text-[13px] text-danger">{loaded.error}</p>
                  ) : isMarkdown(selected) && !source ? (
                    <div className="min-w-0 break-words text-[13px] leading-[21px] text-ink" data-file-rendered=""><ChatMarkdown text={markdownForReading(withoutFrontMatter(loaded.value))} inert /></div>
                  ) : (
                    <div data-file-source=""><CodeBlock code={loaded.value} lang={languageOf(selected)} /></div>
                  )}
                </div>
              </>
            ) : (
              <p className="p-4 text-[13px] text-ink-secondary">{t("connectApps.files.choose")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The quiet pill above Contents: "<name> <version> · current". */
export function VersionPill({ name, version, current }: { name: string; version?: string; current: boolean }) {
  return (
    <span data-contents-pill="" className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full bg-ink/[0.06] px-3 text-[12px] leading-4 text-ink-secondary">
      <span className="truncate text-ink">{[name, version].filter(Boolean).join(" ")}</span>
      <span aria-hidden="true">{"·"}</span>
      <span className="shrink-0">{t(current ? "connectApps.files.current" : "connectApps.files.updateWaiting")}</span>
    </span>
  );
}
