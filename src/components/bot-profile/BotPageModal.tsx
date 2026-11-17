// The one modal of the bot page (#4470): every button or row of the page
// that opens another surface opens it here, over the page, as the reference
// app does (its bot page's setup dialog shell, measured on the installed
// bundle: 560px over 700px, its large dialog 880px wide and at most 640px
// tall, its modal body 24px in). Two sizes here, set once for every row of
// the page (the owner found 560px too small to edit in): "large" for a
// surface that holds an editor, a list or a table, 1100px wide and the room's
// height less 48px above and below; "medium" for a few fields, 720px wide
// and as tall as its content (never a tall half-empty box). Both take the
// room's width less 16px each side on a phone. The look is the reference's:
// 20px corners, a half-pixel hairline, the scrim at half black; the title
// centred, 22px over 28, medium, -0.012em, 40px from the top and the sides,
// its grey line under it at 14px over 20; the round close at 10px from the
// top right; a body 24px in from each side that scrolls; and pills at the
// bottom right (12px over them, 16px under and right, 24px left). A modal
// that opens another stacks the second over it with its own scrim; Escape
// closes the top one and the focus goes back to the button that opened it.
//
// One shell, nothing in duplicate: the layer (DialogLayer: the portal and
// the backdrop), the close button and the keyboard (useModalDialog) are the
// app's own; only the reference's measures are set here.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { DialogCloseButton, DialogLayer } from "../SettingsPrimitives";

/** The reference's measures (chunk team-bot-setup-dialog-shell and the
 * Dialog root's form variant). */
export const BOT_PAGE_MODAL = {
  // DIALOG.frame's entrance; the reference's radius and hairline
  frame: "relative flex flex-col overflow-hidden rounded-[20px] border-[0.5px] border-border bg-app text-ink outline-none transition-[opacity,scale] duration-base ease-out-quint starting:scale-98 starting:opacity-0 motion-reduce:transition-none",
  size: {
    /** an editor, a list or a table: most of the window; the editors inside
     * grow with it through --bot-modal-fill (MarkdownEditor's fillModal) */
    large: "h-[calc(100dvh-96px)] w-[min(1100px,calc(100vw-32px))] [--bot-modal-fill:max(calc((100dvh-96px)/2),calc(100dvh-430px))]",
    /** a list that may be short (Folder, Routines): as wide as large, as tall as its content up to the window */
    wide: "max-h-[calc(100dvh-96px)] w-[min(1100px,calc(100vw-32px))] [--bot-modal-fill:max(calc((100dvh-96px)/2),calc(100dvh-430px))]",
    /** a few fields: wider than the reference's 560px, as tall as its content */
    medium: "max-h-[calc(100dvh-96px)] w-[min(720px,calc(100vw-32px))]",
  },
  header: "relative flex shrink-0 flex-col items-center gap-1 px-6 pb-3 pt-10 text-center",
  title: "w-full min-w-0 text-[22px] font-medium leading-7 tracking-[-0.012em] text-ink",
  description: "w-full min-w-0 text-[14px] leading-5 tracking-[-0.006em] text-ink-secondary",
  /** the body's bottom edge fades while more is below (content-page's tab row fades the same way) */
  bodyFade: "[mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)]",
  body: "flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6 pt-2",
  footer: "flex shrink-0 items-center justify-end gap-2 pb-4 pl-6 pr-4 pt-3",
} as const;

export type BotPageModalSize = keyof typeof BOT_PAGE_MODAL.size;

/** A modal of the bot page. `id` names what it holds (a sub-page, a
 * channel, Memory) for the page's links and tests. */
export function BotPageModal({ id, title, description, size = "medium", footer, bare = false, onClose, children }: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  size?: BotPageModalSize;
  footer?: ReactNode;
  /** a page of the app that draws its own header and close (Memory, its
   * close given `onClose` through PageHostProvider): no title row and no
   * second close, the body fills the window edge to edge */
  bare?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useModalDialog(frameRef, onClose, { popoversOwnEscape: true });
  const bodyRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || bare) return;
    const update = () => setMore(body.scrollHeight - body.scrollTop - body.clientHeight > 4);
    update();
    body.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(body);
    if (body.firstElementChild) observer?.observe(body.firstElementChild);
    return () => { body.removeEventListener("scroll", update); observer?.disconnect(); };
  }, [bare]);
  return (
    <DialogLayer onBackdropMouseDown={onClose}>
      <div
        ref={frameRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={bare ? undefined : titleId}
        aria-label={bare && typeof title === "string" ? title : undefined}
        aria-describedby={description && !bare ? descriptionId : undefined}
        tabIndex={-1}
        data-bot-page-modal={id}
        className={cn(BOT_PAGE_MODAL.frame, BOT_PAGE_MODAL.size[size])}
      >
        {!bare && <DialogCloseButton label={t("common.close")} onClick={onClose} />}
        {!bare && (
          <div data-bot-page-modal-header="" className={BOT_PAGE_MODAL.header}>
            <h2 id={titleId} className={BOT_PAGE_MODAL.title}>{title}</h2>
            {description && <p id={descriptionId} className={BOT_PAGE_MODAL.description}>{description}</p>}
          </div>
        )}
        <div ref={bodyRef} data-bot-page-modal-body="" data-more-below={more ? "" : undefined} className={bare ? "relative flex min-h-0 flex-1 flex-col" : cn(BOT_PAGE_MODAL.body, more && BOT_PAGE_MODAL.bodyFade)}>{children}</div>
        {footer && <div data-bot-page-modal-footer="" className={BOT_PAGE_MODAL.footer}>{footer}</div>}
      </div>
    </DialogLayer>
  );
}
