// The picture at the start of a Library row (2026-10-28): the file's own small
// thumbnail for an image, otherwise one mark per type. A thumbnail is the
// server's 96 px square (?thumb=1), lazy loaded, never the full picture; if it
// cannot load, the row falls back to the image icon.
import { useState } from "react";
import type { ReactNode } from "react";
import { AppWindow, Ban, Building2, Clock, FileArchive, FileCode, FileIcon, FileText, Film, ImageIcon, Link, Lock, Music, PencilLine } from "lucide-react";

import { threadFileThumbUrl, type ThreadFile } from "@/lib/chat-files";
import { fileGlyphKind, pageRowState, type LibraryGlyphKind, type PageRowState } from "@/lib/library-glyph";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { PublishedPageSummary } from "../../../shared/published-pages";
import { PageGlyph } from "../PageViewer";

const SIZE = 24;

/** A colored mark for each type that is not a thumbnail. */
function TypeGlyph({ kind }: { kind: Exclude<LibraryGlyphKind, "thumbnail"> }) {
  switch (kind) {
    case "pdf":
      return (
        <span aria-hidden="true" data-glyph-pdf className="flex size-5 items-center justify-center rounded-[5px] bg-red-500/15 text-[8px] font-bold leading-none tracking-tight text-red-500">PDF</span>
      );
    case "archive":
      return <FileArchive size={16} aria-hidden="true" className="text-amber-500" />;
    case "document":
      return <FileText size={16} aria-hidden="true" className="text-ink-secondary" />;
    case "code":
      return <FileCode size={16} aria-hidden="true" className="text-ink-secondary" />;
    case "video":
      return <Film size={16} aria-hidden="true" className="text-ink-secondary" />;
    case "audio":
      return <Music size={16} aria-hidden="true" className="text-ink-secondary" />;
    case "image":
      return <ImageIcon size={16} aria-hidden="true" className="text-ink-secondary" />;
    default:
      return <FileIcon size={16} aria-hidden="true" className="text-ink-secondary" />;
  }
}

export function FileGlyph({ threadId, file }: { threadId: string; file: ThreadFile }) {
  const [failed, setFailed] = useState(false);
  const kind = fileGlyphKind(file);
  if (kind === "thumbnail" && !failed) {
    return (
      <img
        src={threadFileThumbUrl(threadId, file.id)}
        alt=""
        loading="lazy"
        decoding="async"
        data-library-thumb=""
        width={SIZE}
        height={SIZE}
        onError={() => setFailed(true)}
        className={cn("size-6 shrink-0 rounded-md bg-inset object-cover ring-1 ring-hairline-weak")}
      />
    );
  }
  return <span data-library-glyph={kind === "thumbnail" ? "image" : kind} className="flex size-6 items-center justify-center"><TypeGlyph kind={kind === "thumbnail" ? "image" : kind} /></span>;
}

/** An artifact: private, opens in a Sagax window of its own, so an app
 * window, the same mark as the command palette and the outputs list. */
export function ArtifactRowGlyph() {
  const kind = t("botPanel.library.kind.artifact");
  return (
    <span data-library-glyph="artifact" title={kind} className="flex size-6 items-center justify-center">
      <span aria-hidden="true" className="inline-flex size-5 shrink-0 items-center justify-center rounded-[6px] bg-raised text-ink ring-1 ring-hairline-weak">
        <AppWindow size={13} strokeWidth={2.2} />
      </span>
    </span>
  );
}

const STATE_BADGE: Record<PageRowState, { icon: ReactNode; tone: string } | null> = {
  draft: { icon: <PencilLine size={7} strokeWidth={3} />, tone: "text-ink-secondary" },
  private: { icon: <Lock size={7} strokeWidth={3} />, tone: "text-ink-secondary" },
  org: { icon: <Building2 size={7} strokeWidth={3} />, tone: "text-accent-text" },
  link: { icon: <Link size={7} strokeWidth={3} />, tone: "text-success" },
  revoked: { icon: <Ban size={7} strokeWidth={3} />, tone: "text-danger" },
  expired: { icon: <Clock size={7} strokeWidth={3} />, tone: "text-warning" },
};

/** A published page: the globe page mark with a small corner badge for its
 * state (draft, published for me, the organization or the link, revoked,
 * expired); a draft, revoked or expired page is dimmed. The tooltip names
 * the kind and the state. */
export function PageRowGlyph({ page }: { page: Pick<PublishedPageSummary, "status" | "access" | "expired"> }) {
  const state = pageRowState(page);
  const badge = STATE_BADGE[state];
  const live = state === "private" || state === "org" || state === "link";
  const label = t("botPanel.library.pageTitle", { state: t(`botPanel.library.pageState.${state}`) });
  return (
    <span data-library-glyph="page" data-page-state={state} title={label} className="relative flex size-6 items-center justify-center">
      <PageGlyph size={SIZE - 4} className={cn(!live && "opacity-60")} />
      {badge && (
        <span aria-hidden="true" data-page-state-badge={state}
          className={cn("absolute -bottom-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full bg-panel ring-1 ring-hairline-weak", badge.tone)}>
          {badge.icon}
        </span>
      )}
    </span>
  );
}
