// A folder of files in the record window (M-20261127-146), laid out like the
// macOS Finder whatever plugin serves it: the sidebar (favourites, places,
// tags), the toolbar (back, forward, the icon, list and column views, share,
// tags, search), the icon, list and column views with the column view's
// preview, and the path bar at the bottom. A folder opens in the same window
// with a way back (M-20261127-101); a file opens through the record's own
// route. The search and a tag are the window's one filter (M-20261127-139).
// The Finder's look is its own: its inks are the `--finder-*` tokens of the
// stylesheet, never written here.
//
// The console's sections: `view` (path, places, siblings, summary) and
// `items` (a file through `download`). No plugin serves folders yet: the
// window waits for one.
import { useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLine, ChevronLeft, ChevronRight, Clock, Cloud, Columns3, FileText, Folder, HardDrive, LayoutGrid, List, Monitor, Search, Server, Share, Tag, X } from "lucide-react";
import { useOpenRef } from "@/components/RecordCard";
import { MENU_ROW, MENU_ROW_ACTIVE, MENU_SURFACE } from "@/components/menu-look";
import { RECORD_ACTION, RECORD_ICON_BUTTON } from "@/components/record-window/RecordBlocks";
import { RecordGrid, type RecordColumn } from "@/components/record-window/RecordGrid";
import { RecordName } from "@/components/record-window/ticket/parts";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { downloadBlob } from "@/lib/diagram-view";
import { t } from "@/lib/i18n";
import { FOLDER_TAGS, parseFolderItem, parseFolderView, parseLines, type FolderItem, type FolderPlace, type FolderTag, type FolderView } from "@/lib/record-plugin-views";
import { AskButton, CardFacts, SectionStatus, type PluginContext } from "./PluginParts";
import type { PluginWindowSpec } from "./PluginWindow";

type FinderView = "icons" | "list" | "columns";
const VIEWS: ReadonlyArray<{ id: FinderView; icon: typeof LayoutGrid }> = [{ id: "icons", icon: LayoutGrid }, { id: "list", icon: List }, { id: "columns", icon: Columns3 }];

/** A file's family, for the colour of its badge (the Finder's own per type). */
function fileFamily(ext: string | undefined): string {
  const e = (ext ?? "").toLowerCase();
  if (e === "pdf") return "pdf";
  if (["xlsx", "xls", "csv", "numbers", "ods"].includes(e)) return "sheet";
  if (["docx", "doc", "pages", "rtf", "txt", "md", "odt"].includes(e)) return "doc";
  if (["pptx", "ppt", "key", "odp"].includes(e)) return "slide";
  if (["vsdx", "vsd", "dwg", "svg"].includes(e)) return "drawing";
  if (["png", "jpg", "jpeg", "gif", "heic", "webp", "tif", "tiff", "bmp"].includes(e)) return "image";
  if (["zip", "7z", "rar", "tar", "gz", "dmg", "iso"].includes(e)) return "archive";
  if (["mp3", "wav", "m4a", "aac", "flac"].includes(e)) return "audio";
  if (["mp4", "mov", "mkv", "avi", "webm"].includes(e)) return "video";
  return "other";
}

/** The Finder's folder, or a page with its type's badge. */
function FinderIcon({ item, size }: { item: Pick<FolderItem, "folder" | "ext">; size: number }) {
  if (item.folder) {
    return (
      <svg viewBox="0 0 64 52" width={size} height={Math.round(size * 52 / 64)} aria-hidden="true" className="shrink-0" data-finder-icon="folder">
        <path d="M4 9a4 4 0 0 1 4-4h14l5 5h29a4 4 0 0 1 4 4v3H4z" fill="var(--finder-folder-tab)" />
        <rect x="2" y="14" width="60" height="36" rx="4" fill="var(--finder-folder)" />
        <rect x="2" y="14" width="60" height="4" rx="2" fill="var(--finder-folder-shine)" />
      </svg>
    );
  }
  const ext = (item.ext ?? "").slice(0, 4);
  return (
    <svg viewBox="0 0 44 56" width={Math.round(size * 44 / 56)} height={size} aria-hidden="true" className="shrink-0" data-finder-icon={fileFamily(item.ext)}>
      <path d="M4 2h26l12 12v38a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="var(--finder-page)" />
      <path d="M30 2v10a2 2 0 0 0 2 2h10z" fill="var(--finder-page-fold)" />
      {ext && size >= 28 && <rect x="5" y="36" width="34" height="12" rx="3" fill={`var(--finder-ext-${fileFamily(item.ext)})`} />}
      {ext && size >= 28 && <text x="22" y="45" fontSize="7.5" fontWeight="700" textAnchor="middle" fill="var(--finder-ext-ink)" fontFamily="system-ui, sans-serif">{ext}</text>}
      {ext && size < 28 && <rect x="5" y="40" width="34" height="8" rx="2" fill={`var(--finder-ext-${fileFamily(item.ext)})`} />}
    </svg>
  );
}

function TagDot({ tag, className }: { tag?: FolderTag; className?: string }) {
  if (!tag) return null;
  return <span role="img" aria-label={t(`recordWindow.folder.tag.${tag}` as "recordWindow.folder.tag.red")} className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ backgroundColor: `var(--finder-tag-${tag})` }} data-finder-tag={tag} />;
}

const PLACE_ICONS: Record<string, typeof Folder> = { recents: Clock, desktop: Monitor, documents: FileText, downloads: ArrowDownToLine, server: Server, drive: HardDrive, cloud: Cloud };

function Place({ place, tag, onTag }: { place: FolderPlace; tag?: FolderTag; onTag: (tag: FolderTag | undefined) => void }) {
  const open = useOpenRef(place.ref);
  const Icon = PLACE_ICONS[place.icon ?? ""] ?? Folder;
  const on = place.current || (place.tag !== undefined && place.tag === tag);
  const row = cn("flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-start text-[13px] leading-5", on ? "bg-popover-hover text-popover-ink" : "text-popover-ink hover:bg-popover-hover/60");
  const inner = <>{place.group === "tags" ? <TagDot tag={place.tag} /> : <Icon size={15} aria-hidden="true" className="shrink-0 [color:var(--finder-sidebar-glyph)]" />}<span dir="auto" className="min-w-0 truncate">{place.label}</span></>;
  if (place.group === "tags" && place.tag) return <li><button type="button" className={row} aria-pressed={on} onClick={() => onTag(on ? undefined : place.tag)} data-finder-place="tag">{inner}</button></li>;
  if (open && place.ref && !place.current) return <li><button type="button" className={row} onClick={() => open(place.ref!, place.label)} data-finder-place={place.group}>{inner}</button></li>;
  return <li><span className={row} aria-current={place.current ? "location" : undefined} data-finder-place={place.group}>{inner}</span></li>;
}

function Sidebar({ view, tag, onTag }: { view?: FolderView; tag?: FolderTag; onTag: (tag: FolderTag | undefined) => void }) {
  const groups = (["favorites", "locations", "tags"] as const).map((group) => ({ group, places: (view?.places ?? []).filter((one) => one.group === group) })).filter((one) => one.places.length);
  if (!groups.length) return null;
  return (
    <aside className="record-scroll hidden w-[190px] shrink-0 flex-col gap-3 overflow-y-auto border-e border-popover-hairline [background-color:var(--finder-sidebar)] px-2 py-3 @min-[40rem]:flex" aria-label={t("recordWindow.folder.sidebar")} data-finder-sidebar="">
      {groups.map(({ group, places }) => (
        <div key={group} className="flex flex-col gap-0.5">
          <h3 className="px-2 pb-0.5 text-[11px] font-semibold leading-4 text-popover-ink-secondary">{t(`recordWindow.folder.${group}` as "recordWindow.folder.favorites")}</h3>
          <ul className="flex flex-col gap-0.5">{places.map((place) => <Place key={`${group}-${place.label}`} place={place} tag={tag} onTag={onTag} />)}</ul>
        </div>
      ))}
    </aside>
  );
}

function TagMenu({ tag, onTag }: { tag?: FolderTag; onTag: (tag: FolderTag | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  usePopoverDismiss(open, root, () => setOpen(false));
  return (
    <span ref={root} className="relative inline-flex" onKeyDown={(event) => { if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); } }}>
      <button type="button" className={RECORD_ICON_BUTTON} aria-haspopup="menu" aria-expanded={open} aria-label={t("recordWindow.folder.tags")} title={t("recordWindow.folder.tags")} onClick={() => setOpen(!open)} data-finder-tags="">
        {tag ? <TagDot tag={tag} /> : <Tag size={15} aria-hidden="true" />}
      </button>
      {open && (
        <span role="menu" className={cn(MENU_SURFACE, "absolute end-0 top-full z-20 mt-1 min-w-44")}>
          {FOLDER_TAGS.map((one) => (
            <button key={one} type="button" role="menuitemradio" aria-checked={one === tag} className={one === tag ? MENU_ROW_ACTIVE : MENU_ROW} onClick={() => { setOpen(false); onTag(one === tag ? undefined : one); }}>
              <TagDot tag={one} /><span>{t(`recordWindow.folder.tag.${one}` as "recordWindow.folder.tag.red")}</span>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/** The one filter: the words of the search, and a tag as a token in it. */
function SearchField({ text, tag, onText, onTag }: { text: string; tag?: FolderTag; onText: (text: string) => void; onTag: (tag: FolderTag | undefined) => void }) {
  return (
    <label className="flex h-8 min-w-0 max-w-56 flex-1 items-center gap-1.5 rounded-lg bg-popover-field px-2.5 focus-within:ring-2 focus-within:ring-focus" data-finder-search="">
      <Search size={14} aria-hidden="true" className="shrink-0 text-popover-ink-secondary" />
      {tag && (
        <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md bg-popover-hover px-1.5 text-[12px]">
          <TagDot tag={tag} className="size-2" />{t(`recordWindow.folder.tag.${tag}` as "recordWindow.folder.tag.red")}
          <button type="button" aria-label={t("recordWindow.folder.clearTag")} onClick={(event) => { event.preventDefault(); onTag(undefined); }}><X size={11} aria-hidden="true" /></button>
        </span>
      )}
      <input type="search" value={text} onChange={(event) => onText(event.target.value)} placeholder={t("recordWindow.folder.search")} aria-label={t("recordWindow.folder.searchIn")}
        className="min-w-0 flex-1 bg-transparent text-[13px] leading-5 text-popover-ink placeholder:text-popover-placeholder focus-visible:outline-none" />
    </label>
  );
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

/** What opening an item does: a folder opens in the window (when the person may), a file comes down. */
function useOpenItem(item: FolderItem | undefined, onFile: (item: FolderItem) => void): () => void {
  const openRef = useOpenRef(item?.ref);
  return () => {
    if (!item) return;
    if (!item.folder) { onFile(item); return; }
    if (item.ref && openRef) openRef(item.ref, item.name);
  };
}

/** One item's name, selected by a click and opened by a double click or Enter. */
function ItemButton({ item, selected, onSelect, onFile, className, children }: { item: FolderItem; selected: boolean; onSelect: () => void; onFile: (item: FolderItem) => void; className: string; children: ReactNode }) {
  const onOpen = useOpenItem(item, onFile);
  return (
    <button type="button" aria-pressed={selected} className={cn(className, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus")} onClick={onSelect} onDoubleClick={onOpen}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onOpen(); } }} data-finder-item={item.folder ? "folder" : "file"} data-selected={selected ? "" : undefined} title={item.name}>
      {children}
    </button>
  );
}

const SELECTED = "[background-color:var(--finder-selection)] [color:var(--finder-selection-ink)]";

/** A folder of the path bar: the Finder's small words, opened in the window when the person may. */
function PathCrumb({ label, crumbRef }: { label: string; crumbRef?: FolderView["path"][number]["ref"] }) {
  const open = useOpenRef(crumbRef);
  const inner = <><FinderIcon item={{ folder: true }} size={13} /><span className="whitespace-nowrap">{label}</span></>;
  return open && crumbRef
    ? <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded hover:text-popover-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onClick={() => open(crumbRef, label)} data-finder-crumb="">{inner}</button>
    : <span className="inline-flex shrink-0 items-center gap-1" data-finder-crumb="">{inner}</span>;
}

function Preview({ ctx, item, onFile }: { ctx: PluginContext; item?: FolderItem; onFile: (item: FolderItem) => void }) {
  const onOpen = useOpenItem(item, onFile);
  if (!item) return null;
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 p-4 text-center" data-finder-preview="">
      <FinderIcon item={item} size={96} />
      <b dir="auto" className="break-words [overflow-wrap:anywhere]">{item.name}</b>
      <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{[item.folder ? t("recordWindow.folder.folder") : item.type, item.size].filter(Boolean).join(" · ")}</span>
      <dl className="mt-2 grid w-full min-w-0 gap-x-3 gap-y-1.5 text-start text-[13px] [grid-template-columns:minmax(0,6rem)_minmax(0,1fr)]">
        {item.modified && <><dt className="text-popover-ink-secondary">{t("recordWindow.folder.modifiedShort")}</dt><dd>{item.modified}</dd></>}
        {item.shared && <><dt className="text-popover-ink-secondary">{t("recordWindow.folder.shared")}</dt><dd>{item.shared}</dd></>}
      </dl>
      <span className="mt-1 flex flex-wrap justify-center gap-2">
        <button type="button" className={cn(RECORD_ACTION, "bg-popover-field")} onClick={onOpen}>{t("recordWindow.folder.open")}</button>
        {!item.folder && <AskButton ask={ctx.ask} label={t("recordWindow.folder.summarize")} prompt={t("recordWindow.folder.summarizePrompt", { name: item.name, record: ctx.link })} />}
      </span>
    </div>
  );
}

function Finder({ ctx }: { ctx: PluginContext }) {
  const { card, detail } = ctx;
  const viewState = detail.section("view");
  const itemsState = detail.section("items");
  const view = parseFolderView(viewState.data);
  const items = useMemo(() => parseLines(itemsState.data, parseFolderItem), [itemsState.data]);
  const [mode, setMode] = useState<FinderView>("icons");
  const [chosen, setChosen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [tag, setTag] = useState<FolderTag | undefined>();
  const [failed, setFailed] = useState(false);
  const words = fold(text.trim());
  const shown = items.filter((item) => (!tag || item.tag === tag) && (!words || fold(item.name).includes(words)));
  const selected = shown.find((one) => one.id === chosen) ?? (mode === "columns" ? shown[0] : undefined);
  const parent = view && view.path.length > 1 ? view.path[view.path.length - 2] : undefined;
  const openParent = useOpenRef(parent?.ref);
  if (!itemsState.data) {
    return <div className="record-scroll min-h-0 flex-1 overflow-y-auto p-4">{itemsState.refused ? <CardFacts card={card} now={ctx.now} /> : <SectionStatus state={itemsState} />}</div>;
  }
  const onFile = (item: FolderItem) => {
    setFailed(false);
    detail.bytes("download", item.id).then((blob) => downloadBlob(blob, item.name), () => setFailed(true));
  };
  const back = ctx.back ?? (parent?.ref && openParent ? () => openParent(parent.ref!, parent.label) : undefined);
  const columns: RecordColumn<FolderItem>[] = [
    { id: "name", label: t("recordCard.related.name"), width: 340, text: (row) => row.name, cell: (row) => (
      <ItemButton item={row} selected={selected?.id === row.id} onSelect={() => setChosen(row.id)} onFile={onFile} className="flex w-full min-w-0 items-center gap-2 text-start">
        <ChevronRight size={12} aria-hidden="true" className={cn("shrink-0", !row.folder && "invisible")} /><FinderIcon item={row} size={18} /><span dir="auto" className="min-w-0 truncate">{row.name}</span><TagDot tag={row.tag} />
      </ItemButton>
    ) },
    { id: "modified", label: t("recordWindow.folder.modified"), width: 220, kind: "date", text: (row) => row.modified ?? "" },
    { id: "size", label: t("recordWindow.backup.size"), width: 100, text: (row) => row.folder ? "" : row.size ?? "" },
    { id: "type", label: t("recordCard.related.type"), width: 160, text: (row) => row.folder ? t("recordWindow.folder.folder") : row.type ?? "" },
  ];
  const content = (() => {
    if (!shown.length) return <p role="status" className="p-4 text-popover-ink-secondary">{items.length ? t("recordWindow.noMatch") : t("recordWindow.folder.empty")}</p>;
    if (mode === "list") {
      return <div className="px-2 [&_th]:ps-2 [&_td]:ps-2"><RecordGrid type={ctx.type} grid="finder" filter={false} label={card.title} columns={columns} rows={shown} rowKey={(row) => row.id}
        rowAttributes={(row) => ({ className: selected?.id === row.id ? SELECTED : undefined, "data-finder-row": row.id })} /></div>;
    }
    if (mode === "columns") {
      return (
        <div className="flex h-full min-h-0" data-finder-columns="">
          {view && view.siblings.length > 0 && (
            <ul className="record-scroll w-56 shrink-0 overflow-y-auto border-e border-popover-hairline p-1.5">
              {view.siblings.map((one) => (
                <li key={one.label} className={cn("flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-[13px]", one.current && "bg-popover-hover")}>
                  <FinderIcon item={{ folder: true }} size={18} /><span className="min-w-0 flex-1 truncate"><RecordName name={one.label} recordRef={one.current ? undefined : one.ref} /></span><ChevronRight size={12} aria-hidden="true" />
                </li>
              ))}
            </ul>
          )}
          <ul className="record-scroll w-72 shrink-0 overflow-y-auto border-e border-popover-hairline p-1.5">
            {shown.map((item) => (
              <li key={item.id}>
                <ItemButton item={item} selected={selected?.id === item.id} onSelect={() => setChosen(item.id)} onFile={onFile} className={cn("flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-start text-[13px]", selected?.id === item.id && SELECTED)}>
                  <FinderIcon item={item} size={18} /><span dir="auto" className="min-w-0 flex-1 truncate">{item.name}</span><TagDot tag={item.tag} />{item.folder && <ChevronRight size={12} aria-hidden="true" />}
                </ItemButton>
              </li>
            ))}
          </ul>
          <div className="record-scroll min-w-0 flex-1 overflow-y-auto"><Preview ctx={ctx} item={selected} onFile={onFile} /></div>
        </div>
      );
    }
    return (
      <ul className="grid min-w-0 gap-2 p-4 [grid-template-columns:repeat(auto-fill,minmax(104px,1fr))]" data-finder-icons="">
        {shown.map((item) => (
          <li key={item.id} className="min-w-0">
            <ItemButton item={item} selected={selected?.id === item.id} onSelect={() => setChosen(item.id)} onFile={onFile} className="group flex w-full min-w-0 flex-col items-center gap-1.5 rounded-lg p-1.5 text-center">
              <span className={cn("flex h-16 w-20 items-center justify-center rounded-md", selected?.id === item.id && "bg-popover-hover")}><FinderIcon item={item} size={58} /></span>
              <span className={cn("inline-flex max-w-full items-start gap-1 rounded px-1 text-[13px] leading-[18px]", selected?.id === item.id && SELECTED)}><span dir="auto" className="line-clamp-2 min-w-0 break-words">{item.name}</span><TagDot tag={item.tag} className="mt-1" /></span>
            </ItemButton>
          </li>
        ))}
      </ul>
    );
  })();
  return (
    <div className="flex min-h-0 flex-1" data-finder="">
      <Sidebar view={view} tag={tag} onTag={setTag} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-popover-hairline px-3 py-2" data-finder-toolbar="">
          <span className="inline-flex rounded-lg bg-popover-field">
            <button type="button" className={RECORD_ICON_BUTTON} disabled={!back} onClick={back} aria-label={t("recordWindow.folder.back")} title={t("recordWindow.folder.back")}><ChevronLeft size={16} aria-hidden="true" /></button>
            <button type="button" className={RECORD_ICON_BUTTON} disabled aria-label={t("recordWindow.folder.forward")} title={t("recordWindow.folder.forward")}><ChevronRight size={16} aria-hidden="true" /></button>
          </span>
          <b dir="auto" className="min-w-0 truncate text-[14px]">{card.title}</b>
          <span className="ms-auto inline-flex rounded-lg bg-popover-field p-0.5" role="group" aria-label={t("recordWindow.folder.views")}>
            {VIEWS.map(({ id, icon: Icon }) => (
              <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)} aria-label={t(`recordWindow.folder.view.${id}` as "recordWindow.folder.view.icons")} title={t(`recordWindow.folder.view.${id}` as "recordWindow.folder.view.icons")}
                className={cn("inline-flex size-7 items-center justify-center rounded-md text-popover-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", mode === id && "bg-popover-hover text-popover-ink")} data-finder-view={id}>
                <Icon size={15} aria-hidden="true" />
              </button>
            ))}
          </span>
          {ctx.ask && <button type="button" className={RECORD_ICON_BUTTON} aria-label={t("recordWindow.folder.share")} title={t("recordWindow.folder.share")} onClick={() => ctx.ask!(t("recordWindow.folder.sharePrompt", { name: selected?.name ?? card.title, record: ctx.link }))} data-finder-share=""><Share size={15} aria-hidden="true" /></button>}
          <TagMenu tag={tag} onTag={setTag} />
          <SearchField text={text} tag={tag} onText={setText} onTag={setTag} />
        </div>
        {failed && <p role="status" className="px-4 pt-2 text-[13px] leading-[18px] text-danger">{t("recordCard.related.downloadFailed")}</p>}
        <div className={cn("min-h-0 flex-1", mode === "columns" ? "overflow-hidden" : "record-scroll overflow-y-auto overscroll-contain")} data-finder-content={mode}>{content}</div>
        <div className="flex min-w-0 shrink-0 items-center gap-1 border-t border-popover-hairline px-3 py-1.5 text-[12px] leading-4 text-popover-ink-secondary" data-finder-path="">
          {view?.path.map((crumb, index) => (
            <span key={`${index}-${crumb.label}`} className="inline-flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight size={11} aria-hidden="true" />}
              <PathCrumb label={crumb.label} crumbRef={index === view.path.length - 1 ? undefined : crumb.ref} />
            </span>
          ))}
          {selected && <span className="inline-flex min-w-0 items-center gap-1"><ChevronRight size={11} aria-hidden="true" /><FinderIcon item={selected} size={12} /><span className="min-w-0 truncate">{selected.name}</span></span>}
          {view?.summary && <span className="ms-auto shrink-0">{view.summary}</span>}
        </div>
      </div>
    </div>
  );
}

export const FOLDER_WINDOW: PluginWindowSpec = {
  first: "items",
  open: ["view", "items"],
  reads: { items: ["view", "items"] },
  tabs: () => [],
  sides: () => true,
  body: (ctx) => <Finder ctx={ctx} />,
};
