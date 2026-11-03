// Tools > Memory: one note, the Perspicax console's preview as a page
// (note-preview.tsx, 2026-11-02): "← Memory", the title, "tier / folder ·
// changed <when> by <who>", the tier and tag chips, the body in a card (a
// JSON body or block folds as a tree), then PROPERTIES, LINKS and
// BACKLINKS, and the bar at the bottom right: More (pin, move, delete),
// Neighbourhood (the note on the map) and Edit. Edit keeps the page: the
// title, the tags and the Markdown editor in place of the body.
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, MoreHorizontal, Network, Pencil, Pin, PinOff, FolderInput, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { splitJsonFences, type MemoryNoteDetail } from "@/lib/memory-manager";
import type { JournalFacts, PageLink, PageRow, PageTier } from "@/lib/memory-page";
import { ChatMarkdown } from "../ChatMarkdown";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { MemoryJsonTree } from "./MemoryJsonTree";
import { AuthorBadge, FIELD, fullDate, GHOST_BUTTON, OUTLINE_BUTTON, PRIMARY_BUTTON, relLabel, SECTION_LABEL, Swatch, TagChip } from "./memory-ui";

/** [[Title]] and [[Title|alias]] read as their words (LINKS and BACKLINKS list the notes). */
function plainWikiLinks(text: string): string {
  return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => `**${(alias ?? target).trim()}**`);
}

export function ReadBody({ body, bodyKind }: { body: string; bodyKind: "markdown" | "json" }) {
  if (bodyKind === "json") return <MemoryJsonTree source={body} />;
  return (
    <div className="space-y-3 text-[14px] leading-relaxed text-ink" data-memory-read-body="">
      {splitJsonFences(body).map((part, index) => (
        part.kind === "json"
          ? <MemoryJsonTree key={index} source={part.value} />
          : part.value.trim() ? <ChatMarkdown key={index} text={plainWikiLinks(part.value)} inert /> : null
      ))}
    </div>
  );
}

export interface NoteSave {
  title: string;
  body: string;
  tags: string[];
}

export function MemoryNoteView({
  entry,
  detail,
  tier,
  facts,
  linksOut,
  backlinks,
  pinned,
  startEditing,
  busy,
  onBack,
  onPin,
  onSave,
  onDelete,
  onMove,
  onNeighbourhood,
  onOpenLink,
  linkColor,
  variant = "page",
  onEditPage,
}: {
  entry: PageRow;
  detail: MemoryNoteDetail;
  tier: PageTier | undefined;
  /** A bot note's journal: created, last writer, versions. */
  facts?: JournalFacts;
  linksOut: PageLink[];
  backlinks: PageLink[];
  pinned: boolean;
  startEditing?: boolean;
  busy: boolean;
  onBack: () => void;
  onPin: () => void;
  /** Resolves true once saved (the page leaves edit mode). */
  onSave: (next: NoteSave) => Promise<boolean>;
  onDelete?: () => void;
  onMove?: () => void;
  onNeighbourhood: () => void;
  onOpenLink: (key: string) => void;
  /** The swatch of the tier a linked note lives in. */
  linkColor: (key: string) => string | undefined;
  /** "panel": the console's preview (a click on a row): no back link, and
   * Edit opens the note's page in edit mode (`onEditPage`). */
  variant?: "page" | "panel";
  onEditPage?: () => void;
}) {
  const panel = variant === "panel";
  const [editing, setEditing] = useState(Boolean(startEditing && detail.mayEdit));
  const [draft, setDraft] = useState(detail.body);
  const [draftTitle, setDraftTitle] = useState(detail.title);
  const [draftTags, setDraftTags] = useState(detail.tags.join(", "));
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDraft(detail.body);
    setDraftTitle(detail.title);
    setDraftTags(detail.tags.join(", "));
  }, [detail]);

  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: PointerEvent) => { if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [moreOpen]);

  const isPx = entry.source.kind === "perspicax";
  const author = detail.author ?? entry.row.author;
  const updatedAt = detail.updatedAt ?? entry.row.updatedAt;
  const createdAt = detail.createdAt ?? entry.row.createdAt ?? facts?.createdAt;
  const changed = relLabel(updatedAt);
  const where = [tier?.name, entry.folderPath].filter(Boolean).join(" / ");
  const line = [
    where,
    changed ? (author ? t("memoryManager.note.changedBy", { when: changed, who: author }) : t("memoryManager.note.changed", { when: changed })) : "",
  ].filter(Boolean).join(" · ");
  const versions = detail.versions ?? (facts ? facts.versions : null);
  const mode = !detail.mayEdit
    ? t("memoryManager.note.modeRead")
    : detail.editMode === "review" ? t("memoryManager.note.modeReview") : t("memoryManager.note.modeDirect");
  const provenance = detail.provenance?.length
    ? detail.provenance.map((item) => (item.kind === "console" ? t("memoryManager.note.provConsole") : item.kind === "ticket" ? t("memoryManager.note.provTicket", { ref: item.reference }) : `${item.kind} : ${item.reference}`)).join(" · ")
    : undefined;
  const origin = detail.origin ?? (entry.source.kind === "bot" ? t("memoryManager.note.originBot", { bot: entry.source.name }) : entry.source.kind === "team" ? t("memoryManager.note.originTeam") : undefined);
  const lastVia = facts?.rows.at(-1)?.threadTitle;

  const save = async () => {
    const ok = await onSave({ title: draftTitle.trim() || detail.title, body: draft, tags: draftTags.split(",").map((tag) => tag.trim()).filter(Boolean) });
    if (ok) setEditing(false);
  };

  const linkList = (links: PageLink[], data: string) => (
    <ul className="flex flex-col gap-1" {...{ [data]: "" }}>
      {links.map((link) => (
        <li key={link.key}>
          <button type="button" className="inline-flex max-w-full items-center gap-1.5 rounded-md text-left text-[13px] text-ink hover:underline" onClick={() => onOpenLink(link.key)}>
            <Swatch color={linkColor(link.key) ?? "var(--color-ink-tertiary)"} />
            <span className="truncate font-medium">{link.title}</span>
            <ArrowUpRight size={12} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
          </button>
          {link.context && <p className="ml-3.5 mt-0.5 truncate text-[12px] text-ink-secondary">{link.context}</p>}
        </li>
      ))}
    </ul>
  );

  const props: Array<[string, React.ReactNode]> = [
    [t("memoryManager.note.propTier"), <span className="inline-flex items-center gap-1.5">{tier && <Swatch color={tier.color} />}{tier?.name}{` · ${mode}`}</span>],
    [t("memoryManager.note.propAuthor"), author ? <AuthorBadge name={author} /> : t("memoryManager.note.unknown")],
  ];
  if (createdAt) props.push([t("memoryManager.note.propCreated"), fullDate(createdAt)]);
  if (updatedAt) props.push([t("memoryManager.note.propChanged"), <span title={fullDate(updatedAt)}>{changed}</span>]);
  if (provenance || lastVia) props.push([t("memoryManager.note.propProvenance"), provenance ?? lastVia]);
  if (origin) props.push([t("memoryManager.note.propSource"), origin]);
  if (versions != null) props.push([t("memoryManager.note.propVersions"), t("memoryManager.note.versions", { n: versions })]);
  if (entry.row.path) props.push([t("memoryManager.note.propFile"), <code className="text-[12px]">{entry.row.path}</code>]);

  return (
    <article className={cn("relative mx-auto flex w-full max-w-[920px] flex-col gap-4", panel ? "pb-4" : "pb-20")} {...(panel ? { "data-memory-preview": "" } : { "data-memory-note": "" })} data-memory-note-key={entry.key}>
      {!panel && (
        <button type="button" className="inline-flex items-center gap-1.5 self-start rounded-md text-[13px] text-ink-secondary hover:text-ink" onClick={onBack} data-memory-note-back="">
          <ArrowLeft size={14} aria-hidden="true" />{t("memoryManager.title")}
        </button>
      )}
      <header className="min-w-0">
        {editing ? (
          <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} className={cn(FIELD, "text-[20px] font-semibold")} aria-label={t("memoryManager.titleField")} data-memory-rename="" />
        ) : (
          <h2 className="break-words text-[22px] font-semibold leading-[1.3] text-ink">{detail.title}</h2>
        )}
        <p className="mt-1 text-[13px] text-ink-secondary" data-memory-note-line="">{line}</p>
      </header>
      <div className="flex flex-wrap items-center gap-1.5">
        {tier && <span className="inline-flex items-center gap-1.5 rounded-full bg-raised px-2 py-px text-[11px] font-medium text-ink"><Swatch color={tier.color} />{tier.name}</span>}
        {editing && isPx ? (
          <input value={draftTags} onChange={(event) => setDraftTags(event.target.value)} placeholder={t("memoryManager.tagsHint")} aria-label={t("memoryManager.tags")} className={cn(FIELD, "h-7 max-w-md py-0 text-[12.5px]")} data-memory-tags="" />
        ) : detail.tags.map((tag) => <TagChip key={tag}>{tag}</TagChip>)}
      </div>

      <div className="min-w-0 rounded-xl border border-hairline/50 bg-panel p-5" data-memory-note-body="">
        {editing
          ? <MarkdownEditor value={draft} onChange={setDraft} minHeight={320} showCount={false} dataField="memory-manager-note" ariaLabel={t("memoryManager.editorLabel")} />
          : detail.sealed ? <p className="text-[13px] text-ink-secondary">{t("memoryManager.note.sealed")}</p> : <ReadBody body={detail.body} bodyKind={detail.bodyKind} />}
      </div>

      <section>
        <h3 className={cn(SECTION_LABEL, "mb-2")}>{t("memoryManager.note.properties")}</h3>
        <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]" data-memory-note-props="">
          {props.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-secondary">{label}</dt>
              <dd className="min-w-0 text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {linksOut.length > 0 && (
        <section>
          <h3 className={cn(SECTION_LABEL, "mb-2 flex items-center gap-2")}>{t("memoryManager.note.links")}<span className="tabular-nums">{linksOut.length}</span></h3>
          {linkList(linksOut, "data-memory-note-links")}
        </section>
      )}
      <section>
        <h3 className={cn(SECTION_LABEL, "mb-2 flex items-center gap-2")}>{t("memoryManager.note.backlinks")}<span className="tabular-nums">{backlinks.length}</span></h3>
        {backlinks.length ? linkList(backlinks, "data-memory-note-backlinks") : <p className="text-[13px] text-ink-secondary">{t("memoryManager.note.noBacklinks")}</p>}
      </section>

      <div className={cn("pointer-events-none sticky z-20 flex justify-end", panel ? "bottom-0" : "bottom-4")}>
        <div className="pointer-events-auto relative flex items-center gap-1.5 rounded-full border border-hairline/60 bg-elevated p-1 shadow-sm" data-memory-note-toolbar="">
          {editing ? (
            <>
              <button type="button" className={GHOST_BUTTON} onClick={() => { setEditing(false); setDraft(detail.body); setDraftTitle(detail.title); setDraftTags(detail.tags.join(", ")); }}>{t("common.cancel")}</button>
              <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={() => void save()} data-memory-note-save="">{t("common.save")}</button>
            </>
          ) : (
            <>
              <div ref={moreRef} className="relative">
                <button type="button" className={GHOST_BUTTON} aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)} data-memory-note-more="">
                  <MoreHorizontal size={16} aria-hidden="true" />{t("memoryManager.note.more")}
                </button>
                {moreOpen && (
                  <div role="menu" className="absolute bottom-full right-0 mb-2 flex w-[220px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border bg-elevated p-1.5 popover-surface">
                    <button type="button" role="menuitem" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink hover:bg-hover" onClick={() => { setMoreOpen(false); onPin(); }} data-memory-note-pin="">
                      {pinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}{pinned ? t("memoryManager.unpin") : t("memoryManager.pin")}
                    </button>
                    {onMove && (
                      <button type="button" role="menuitem" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink hover:bg-hover" onClick={() => { setMoreOpen(false); onMove(); }} data-memory-note-move="">
                        <FolderInput size={14} aria-hidden="true" />{t("memoryManager.move")}
                      </button>
                    )}
                    {onDelete && (
                      <>
                        <div role="separator" className="mx-1 my-1 h-px bg-hairline/50" />
                        <button type="button" role="menuitem" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-danger hover:bg-hover" onClick={() => { setMoreOpen(false); onDelete(); }} data-memory-note-delete="">
                          <Trash2 size={14} aria-hidden="true" />{t("memoryManager.delete")}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <button type="button" className={OUTLINE_BUTTON} onClick={onNeighbourhood} data-memory-note-neighbourhood="">
                <Network size={14} aria-hidden="true" />{t("memoryManager.note.neighbourhood")}
              </button>
              {detail.mayEdit && (
                <button type="button" className={PRIMARY_BUTTON} onClick={() => (panel && onEditPage ? onEditPage() : setEditing(true))} data-memory-note-edit="">
                  <Pencil size={14} aria-hidden="true" />{t("memoryManager.edit")}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}
