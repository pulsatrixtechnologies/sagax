import { activeLocale, t } from "@/lib/i18n";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Quote, X } from "lucide-react";
import {
  CITATION_MAX_COMMENT_LENGTH,
  CITATION_MAX_QUOTE_LENGTH,
  citationAttachment,
  withCitationComment,
  type CitationAttachment,
} from "@/lib/citations";
import { captureCitationSelection, citationTabShortcut } from "@/lib/citations-dom";
import { sendsMessage, useSendKey } from "@/lib/send-key";
import { appShortcutFor } from "@/lib/keyboard-shortcuts";

type Point = { left: number; top: number };

function place(element: HTMLElement, point: Point): void {
  const rect = element.getBoundingClientRect();
  element.style.left = `${Math.max(8, Math.min(point.left, window.innerWidth - rect.width - 8))}px`;
  element.style.top = `${Math.max(8, Math.min(point.top, window.innerHeight - rect.height - 8))}px`;
}

function focusComposer(): void {
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-tour="composer"] textarea')?.focus());
}

function CitationEditor({
  citation,
  point,
  onSave,
  onCancel,
  sending = false,
}: {
  citation: CitationAttachment;
  point?: Point;
  onSave: (citation: CitationAttachment) => void;
  onCancel: () => void;
  sending?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [comment, setComment] = useState(citation.comment ?? "");
  const sendKey = useSendKey();
  const tooLong = comment.length > CITATION_MAX_COMMENT_LENGTH;
  useLayoutEffect(() => {
    const update = () => {
      const editor = ref.current;
      if (!editor) return;
      const input = point ? null : document.querySelector<HTMLTextAreaElement>('[data-tour="composer"] textarea');
      const rect = input?.getBoundingClientRect();
      place(editor, point ?? {
        left: rect ? rect.left + (rect.width - editor.offsetWidth) / 2 : 8,
        top: rect ? rect.top - editor.offsetHeight - 8 : 8,
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [point]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={t("citation.commentDialog")}
      className="fixed z-50 w-[min(28rem,calc(100vw-1rem))] rounded-xl border border-hairline/50 popover-surface bg-panel p-3 text-ink shadow-2xl"
      style={point}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="mb-2 max-h-36 overflow-auto rounded-lg border border-hairline/30 bg-inset px-3 py-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">{t("citation.quoted")}</div>
        <pre dir="auto" className="whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed">{citation.quote}</pre>
      </div>
      <textarea
        ref={inputRef}
        dir="auto"
        value={comment}
        rows={3}
        aria-label={t("citation.commentSelected")}
        aria-invalid={tooLong || undefined}
        placeholder={t("citation.commentPlaceholder")}
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={(event) => {
          if (sendsMessage(event.nativeEvent, sendKey)) {
            event.preventDefault();
            if (!tooLong) onSave(withCitationComment(citation, comment));
          }
        }}
        className="w-full resize-none rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] outline-none focus:border-accent"
      />
      {tooLong && <p role="status" className="mt-1 text-[11px] text-danger">{t("citation.tooLong", { count: CITATION_MAX_COMMENT_LENGTH.toLocaleString(activeLocale()) })}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-[12px] text-ink-secondary hover:bg-raised">{t("common.cancel")}</button>
        <button type="button" disabled={tooLong} onClick={() => onSave(withCitationComment(citation, comment))} className="ui-button-primary rounded-lg px-3 py-1.5 text-[12px] font-medium disabled:opacity-40">{t(sending && comment.trim() ? "chat.send" : "common.save")}</button>
      </div>
    </div>,
    document.body,
  );
}

export function CitationSelectionToolbar({
  viewportRef,
  onAdd,
  onReply,
}: {
  viewportRef: RefObject<HTMLElement | null>;
  onAdd: (citation: CitationAttachment) => void;
  onReply?: (citation: CitationAttachment) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tabShortcut = useRef(citationTabShortcut()).current;
  const [captured, setCaptured] = useState<{
    citation: CitationAttachment;
    point: Point;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false);
  const addRef = useRef(onAdd);
  addRef.current = onAdd;

  useEffect(() => {
    if (!captured) tabShortcut.reset();
    const update = () => {
      if (editingRef.current) return;
      const viewport = viewportRef.current;
      const selection = viewport ? captureCitationSelection(viewport, window.getSelection()) : null;
      if (!selection) { setCaptured(null); return; }
      const { citationSource: messageId, citationOwnerType: ownerType, citationOwner: ownerId, citationThread: threadId } = selection.source.dataset;
      if (!messageId || !ownerId || !threadId || (ownerType !== "bot" && ownerType !== "group")) { setCaptured(null); return; }
      const rects = selection.range.getClientRects();
      const rect = rects.item(rects.length - 1) ?? selection.range.getBoundingClientRect();
      setCaptured({
        citation: selection.selector.text.length <= CITATION_MAX_QUOTE_LENGTH
          ? citationAttachment({ ownerType, ownerId, threadId, messageId }, selection.selector)
          : {
              kind: "citation",
              version: 1,
              id: "selection-too-long",
              quote: selection.selector.text,
              source: { ownerType, ownerId, threadId, messageId, ...selection.selector },
              size: selection.selector.text.length,
            },
        point: { left: rect.left, top: rect.bottom + 8 },
      });
    };
    document.addEventListener("selectionchange", update);
    viewportRef.current?.addEventListener("pointerup", update);
    viewportRef.current?.addEventListener("keyup", update);
    const focusAction = (event: KeyboardEvent) => {
      if (!captured || editing) return;
      // ⌘L / Ctrl+L quotes the selection into the message at once (the reference
      // design's "add selection to prompt"); Cite then Save does the same with a comment.
      if (appShortcutFor(event) === "quote-selection") {
        if (captured.citation.quote.length > CITATION_MAX_QUOTE_LENGTH) return;
        event.preventDefault();
        event.stopPropagation();
        addRef.current(captured.citation);
        window.getSelection()?.removeAllRanges();
        setCaptured(null);
        focusComposer();
        return;
      }
      tabShortcut.handle(event, buttonRef.current);
    };
    document.addEventListener("keydown", focusAction, true);
    return () => {
      document.removeEventListener("selectionchange", update);
      viewportRef.current?.removeEventListener("pointerup", update);
      viewportRef.current?.removeEventListener("keyup", update);
      document.removeEventListener("keydown", focusAction, true);
    };
  }, [captured, editing, tabShortcut, viewportRef]);

  useLayoutEffect(() => {
    if (!captured || editing) return;
    const update = () => { if (buttonRef.current) place(buttonRef.current, captured.point); };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [captured, editing]);
  if (!captured) return null;
  if (editing) {
    return <CitationEditor
      citation={captured.citation}
      point={captured.point}
      sending={Boolean(onReply)}
      onCancel={() => { editingRef.current = false; setEditing(false); setCaptured(null); focusComposer(); }}
      onSave={(citation) => {
        if (citation.comment?.trim() && onReply) onReply(citation);
        else onAdd(citation);
        window.getSelection()?.removeAllRanges();
        editingRef.current = false;
        setEditing(false);
        setCaptured(null);
        focusComposer();
      }}
    />;
  }
  const tooLong = captured.citation.quote.length > CITATION_MAX_QUOTE_LENGTH;
  return createPortal(
    <button
      ref={buttonRef}
      type="button"
      disabled={tooLong}
      aria-label={tooLong ? "Selection is too long to cite" : "Cite selected text"}
      onPointerDown={(event) => { event.preventDefault(); editingRef.current = true; }}
      onClick={() => { editingRef.current = true; setEditing(true); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); setCaptured(null); }
      }}
      className="fixed z-50 flex items-center gap-1.5 rounded-full border border-hairline/50 bg-panel px-3 py-1.5 text-[12px] font-medium text-ink shadow-lg disabled:text-danger"
      style={captured.point}
    >
      <Quote size={13} aria-hidden="true" /> {tooLong ? "Shorten selection" : "Cite"}
    </button>,
    document.body,
  );
}

export function CitationBadge({
  citation,
  onChange,
  onRemove,
  onNavigate,
}: {
  citation: CitationAttachment;
  onChange?: (citation: CitationAttachment) => void;
  onRemove?: () => void;
  onNavigate?: () => Promise<boolean>;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const rect = triggerRef.current?.getBoundingClientRect();
  const point = { left: rect?.left ?? 8, top: (rect?.bottom ?? 8) + 6 };
  const restoreTriggerFocus = () => requestAnimationFrame(() => triggerRef.current?.focus());
  useEffect(() => {
    if (open) requestAnimationFrame(() => detailsRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const trigger = triggerRef.current;
      const details = detailsRef.current;
      if (!trigger || !details) return;
      const rect = trigger.getBoundingClientRect();
      place(details, { left: rect.left, top: rect.bottom + 6 });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open]);
  if (editing && onChange) {
    return <CitationEditor
      citation={citation}
      onCancel={() => { setEditing(false); restoreTriggerFocus(); }}
      onSave={(next) => { onChange(next); setEditing(false); restoreTriggerFocus(); }}
    />;
  }
  return (
    <span className="relative inline-flex max-w-full items-center gap-1">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { setUnavailable(false); setOpen((value) => !value); }}
        aria-expanded={open}
        aria-label={`Open citation: ${citation.quote.slice(0, 80)}`}
        className="inline-flex max-w-64 items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] text-accent-text hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60"
      >
        <Quote size={11} className="shrink-0" aria-hidden="true" />
        <span className="truncate">{citation.quote.replace(/\s+/g, " ")}</span>
      </button>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={t("citation.remove")} className="flex size-5 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"><X size={11} /></button>
      )}
      {open && createPortal(
        <div
          role="dialog"
          aria-label={t("citation.details")}
          className="fixed z-50 w-[min(30rem,calc(100vw-1rem))] rounded-xl border border-hairline/50 popover-surface bg-panel p-3 text-left text-ink shadow-2xl"
          style={point}
          ref={(element) => {
            detailsRef.current = element;
            if (element) place(element, point);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); setOpen(false); restoreTriggerFocus(); }
          }}
        >
          <div className="max-h-56 overflow-auto rounded-lg bg-inset px-3 py-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">{t("citation.quoted")}</div>
            <pre dir="auto" className="whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed">{citation.quote}</pre>
          </div>
          {citation.comment && <div className="mt-2 text-[12px]"><span className="font-semibold">{t("citation.commentLabel")}</span> <span className="whitespace-pre-wrap">{citation.comment}</span></div>}
          {unavailable && <p role="status" className="mt-2 text-[11px] text-warning">{t("citation.sourceGone")}</p>}
          <div className="mt-3 flex justify-end gap-2">
            {onNavigate && <button type="button" onClick={() => { void onNavigate().then((found) => { setUnavailable(!found); if (found) setOpen(false); }); }} className="rounded-lg border border-hairline/40 px-3 py-1.5 text-[12px] hover:bg-raised">{t("citation.goToSource")}</button>}
            {onChange && <button type="button" onClick={() => { setOpen(false); setEditing(true); }} className="rounded-lg border border-hairline/40 px-3 py-1.5 text-[12px] hover:bg-raised">{t("citation.editComment")}</button>}
            <button type="button" onClick={() => { setOpen(false); restoreTriggerFocus(); }} className="rounded-lg bg-accent px-3 py-1.5 text-[12px] text-accent-ink">{t("common.close")}</button>
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}

export function SentCitations({ citations, onNavigate }: { citations: CitationAttachment[]; onNavigate: (citation: CitationAttachment) => Promise<boolean> }) {
  if (!citations.length) return null;
  return <div className="mt-2 flex flex-wrap gap-1.5">{citations.map((citation) => <CitationBadge key={citation.id} citation={citation} onNavigate={() => onNavigate(citation)} />)}</div>;
}
