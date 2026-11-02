// A bot-authored widget in the transcript (message kind "widget"): one card
// with a header, a body drawn from the node tree, and its actions under it.
// This component owns what the person has typed into it and the life of a
// press: sending, sent, refused, and settled into one line. A press that
// settles it folds the card as soon as the server has taken it; the patched
// row (`message.patch`) then replaces what was drawn here.
// docs/superpowers/specs/2026-10-13-chat-widgets-design.md
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CircleAlert, X } from "lucide-react";
import { useStore, type Message } from "@/state/store";
import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  widgetActions, widgetAppAction, widgetFields, widgetInitialValues, widgetScope, widgetString, type WidgetField, type WidgetNode, type WidgetPayload, type WidgetSettled,
  type WidgetValues,
} from "../../../shared/widget";
import { ASK_QUIET_BUTTON, AskSettledLine, returnFocusToComposer } from "../AskCard";
import { WidgetBody } from "./WidgetBody";
import { WIDGET_COMPACT_BELOW, widgetActionUrl, WidgetButton, WidgetFormProvider, WidgetGlyph, type WidgetForm } from "./WidgetControls";
import { kids } from "./widget-style";
import { performWidgetAppAction } from "./widget-device";
import { newWidgetSendId, sendWidgetAction, type WidgetSendResult } from "./widget-send";

/** Up to 600px on desktop, by the root's `size`, and never wider than the chat column. */
export const WIDTH: Record<string, string> = { sm: "max-w-[360px]", md: "max-w-[440px]", lg: "max-w-[600px]", full: "max-w-[600px]" };
/** The surface of every ask in the chat (AskCard, the question and sign-in cards): the composer's tone,
 * its 1px ring, the 24px corner. No shadow of its own: nothing else in the thread floats. */
export const SURFACE = "w-full overflow-hidden rounded-3xl bg-composer ring-1 ring-composer-ring transition-opacity";
/** How long a press that leaves the widget live shows its tick. */
const SENT_MS = 1600;

/** The fields a Label node names: a field's own `label` is drawn only where none does. */
function labelledFields(node: WidgetNode, into = new Set<string>()): Set<string> {
  if (node.type === "Label" && typeof node.fieldName === "string") into.add(node.fieldName);
  for (const child of kids(node)) labelledFields(child, into);
  return into;
}

/** A required field that a confirming press may not leave empty. */
function isEmpty(field: WidgetField, values: WidgetValues): boolean {
  const value = values[field.name];
  return field.type === "Checkbox" ? value !== true : typeof value !== "string" || !value.trim();
}

export function WidgetMessage({ botId, threadId, message }: { botId: string; threadId?: string; message: Message }) {
  const payload = message.widget;
  // a row with no tree to draw still says what it said
  if (!payload?.root || typeof payload.root !== "object" || typeof payload.root.type !== "string") {
    return message.text
      ? <div className="chat-text w-fit max-w-[min(42rem,78%)] rounded-2xl bg-card px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-ink">{message.text}</div>
      : null;
  }
  // An update_widget renumbers node ids, and everything the card holds is tied to them or to the tree they name:
  // what was typed, a sent tick, a line folded ahead of the patch frame. A new revision starts the card again.
  return <WidgetCard key={payload.rev ?? 0} botId={botId} threadId={threadId} messageId={message.id} payload={payload} />;
}

function WidgetCard({ botId, threadId, messageId, payload }: { botId: string; threadId?: string; messageId: string; payload: WidgetPayload }) {
  const root = payload.root;
  const { flushBotPatches, dispatch } = useStore();
  /** Settled by a press from this card: the line folds on the server's 2xx, ahead of the patch frame. */
  const [settledHere, setSettledHere] = useState<WidgetSettled>();
  /** The row has said it is settled since this card's last press. From then on its word is the only one, in
   * whichever order the patch frame and the POST's answer land: a queued press the person cancels is patched
   * back to live, and a line folded here must not outlive that. */
  const [rowSpoke, setRowSpoke] = useState(false);
  if (payload.settled !== undefined && !rowSpoke) setRowSpoke(true);
  const settled = payload.settled ?? (rowSpoke ? undefined : settledHere);
  const isSettled = settled !== undefined;
  const uid = useId();
  const frame = useRef<HTMLDivElement | null>(null);
  /** The card is too narrow for a label and a field side by side. Measured on the card itself, not the
   * window: the chat column narrows with a side panel open as much as with a small window. */
  const [compact, setCompact] = useState(false);
  const watch = useCallback((element: HTMLDivElement | null) => {
    frame.current = element;
    if (!element) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      // nothing laid out yet (a hidden Details, a test page): keep what was there
      if (width > 0) setCompact(width < WIDGET_COMPACT_BELOW);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  /** What the person changed, over the tree's own defaults. */
  const [edits, setEdits] = useState<WidgetValues>({});
  /** The ref being sent, until the server answers. */
  const [pending, setPending] = useState<string>();
  const [sent, setSent] = useState<string>();
  const [problem, setProblem] = useState<{ text: string; field?: string }>();
  const [details, setDetails] = useState(false);
  const [imagesAllowed, setImagesAllowed] = useState(false);
  /** A press that got no answer goes again under the same sendId, so the server counts it once. */
  const retry = useRef<{ key: string; sendId: string }>(undefined);
  /** This card sent the press that settles it, so the focus it held is its to hand on. */
  const answering = useRef(false);
  /** A send is on its way. Set as it starts, not on the next render: two presses in one tick are one press. */
  const sendingNow = useRef(false);
  const mounted = useRef(true);
  const sentTimer = useRef<number>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(sentTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!isSettled) return;
    // the patched row can arrive before the POST's own answer does
    setPending(undefined);
    if (!answering.current) return;
    answering.current = false;
    // the card folds away with the control that answered it: hand focus to the composer
    returnFocusToComposer();
  }, [isSettled]);

  const actions = useMemo(() => new Map(widgetActions(root).map((entry) => [entry.ref, entry])), [root]);
  const fields = useMemo(() => new Map(widgetFields(root).map((field) => [field.name, field])), [root]);
  const labelled = useMemo(() => labelledFields(root), [root]);
  // a settled card shows what went with the press, not the defaults it started from
  const values = useMemo(() => ({ ...widgetInitialValues(root), ...edits, ...settled?.values }), [root, edits, settled]);

  const press = (ref: string) => {
    const entry = actions.get(ref);
    if (!entry || sendingNow.current || pending !== undefined) return;
    if (entry.client) {
      const place = widgetAppAction(entry.action);
      if (!place) {
        // opens on this device and is never sent
        const url = widgetActionUrl(entry);
        if (url) void openExternalLink(url);
        return;
      }
      // An in-app place opens here at once; the press is then recorded for
      // the bot as already done (it starts no turn), so it never has to try.
      performWidgetAppAction(dispatch, place, botId);
      void sendWidgetAction({ botId, threadId, messageId, ref, rev: payload.rev ?? 0, sendId: newWidgetSendId() });
      return;
    }
    if (settled) return;
    let sending: WidgetValues | undefined;
    if (entry.tone !== "cancel") {
      const scope = widgetFields(widgetScope(root, ref), root);
      const empty = entry.tone ? scope.find((field) => field.node.required === true && isEmpty(field, values)) : undefined;
      if (empty) {
        setProblem({ text: t("widget.required", { label: empty.label }), field: empty.name });
        frame.current?.querySelector<HTMLElement>(`[data-widget-field="${empty.name}"]`)?.focus();
        return;
      }
      sending = Object.fromEntries(scope.map((field) => [field.name, values[field.name] ?? (field.type === "Checkbox" ? false : "")]));
    }
    const key = `${ref}\n${JSON.stringify(sending ?? null)}`;
    const sendId = retry.current?.key === key ? retry.current.sendId : newWidgetSendId();
    retry.current = { key, sendId };
    sendingNow.current = true;
    answering.current = entry.tone !== undefined;
    setRowSpoke(false);
    setSettledHere(undefined);
    setProblem(undefined);
    setSent(undefined);
    setPending(ref);
    // A bot setting just changed (approval level, model) is saved before the press starts a turn; if that save fails, nothing is posted.
    // The task-settings half of the store's waitForExecutionSettings is not awaited here: it is private to the store.
    const saved: Promise<unknown> = Promise.resolve().then(() => flushBotPatches(botId));
    const unsaved = (): WidgetSendResult => ({ ok: false, refused: false });
    void saved.then(() => sendWidgetAction({ botId, threadId, messageId, ref, rev: payload.rev ?? 0, values: sending, sendId }), unsaved).then((result) => {
      sendingNow.current = false;
      if (!mounted.current) return;
      if (!result.ok) {
        // a refusal is an answer: the next press is a new one
        if (result.refused) retry.current = undefined;
        answering.current = false;
        setPending(undefined);
        setProblem({ text: result.error ?? t("widget.sendFailed") });
        return;
      }
      retry.current = undefined;
      if (entry.tone) {
        // taken: fold now, from what was pressed and sent, without waiting on the patch frame (if the frame came first, it rules)
        setSettledHere({ ref, label: entry.label, tone: entry.tone, at: Date.now(), sendId, ...(sending ? { values: sending } : {}) });
        return;
      }
      setPending(undefined);
      setSent(ref);
      window.clearTimeout(sentTimer.current);
      sentTimer.current = window.setTimeout(() => mounted.current && setSent(undefined), SENT_MS);
    });
  };

  const errorId = `${uid}-problem`;
  const title = widgetString(root, "title");
  const caption = widgetString(root, "caption");
  const meta = widgetString(root, "meta");
  const status = root.status && typeof root.status === "object" ? root.status as { text?: unknown; icon?: unknown } : {};
  const statusText = typeof status.text === "string" ? status.text : undefined;
  const headed = Boolean(title || caption || meta || statusText);
  const name = title ?? statusText ?? t("widget.aria.card");
  const form: WidgetForm = {
    uid,
    values,
    setValue: (name, value) => {
      setEdits((current) => ({ ...current, [name]: value }));
      if (problem?.field === name) setProblem(undefined);
    },
    locked: isSettled || pending !== undefined,
    invalid: problem?.field,
    errorId,
    fields,
    actions,
    pendingRef: pending,
    sentRef: sent,
    press,
    imagesAllowed,
    allowImages: () => setImagesAllowed(true),
    labelled,
    compact,
    name: title ?? statusText ?? "",
  };
  const confirm = actions.get("confirm");
  const cancel = actions.get("cancel");

  const card = (
    <WidgetFormProvider value={form}>
      <div
        ref={watch}
        role="group"
        aria-label={name}
        aria-busy={pending !== undefined || undefined}
        data-widget={messageId}
        data-widget-state={settled ? "settled" : pending !== undefined ? "sending" : "live"}
        data-widget-compact={compact || undefined}
        className={cn("w-full text-start", WIDTH[widgetString(root, "size") ?? "lg"] ?? WIDTH.lg)}
      >
        <div className={cn(SURFACE, pending !== undefined && "opacity-[0.55]")}>
          {headed && (
            // the header of a question card (AskCard): the ask in 15px, a line on why in 13px, a quiet count on the right
            <div className={cn("flex items-start gap-3 px-4 pt-3.5", kids(root).length ? "pb-3" : "pb-3.5")}>
              <div className="min-w-0 flex-1">
                {statusText && (
                  <p className={cn("flex items-center gap-1.5 text-[12.5px] font-semibold leading-[18px] text-accent-text", (title || caption) && "mb-1")}>
                    {typeof status.icon === "string" && <WidgetGlyph name={status.icon} size={14} />}
                    <bdi dir="auto" className="min-w-0 truncate">{statusText}</bdi>
                  </p>
                )}
                {title && <div title={title} className="truncate text-[15px] font-semibold leading-6 text-ink"><bdi dir="auto">{title}</bdi></div>}
                {caption && <div dir="auto" className="mt-0.5 text-[13px] leading-snug text-ink-secondary">{caption}</div>}
              </div>
              {meta && <span dir="auto" className="mt-1 shrink-0 whitespace-nowrap text-[12px] leading-4 tabular-nums text-ink-tertiary">{meta}</span>}
            </div>
          )}
          <WidgetBody root={root} headed={headed} />
          {problem && (
            // the reason sits inside the card, in the server's own sentence, and the card stays live
            <div id={errorId} role="alert" className="mx-4 flex items-start gap-2 border-t border-ink/[0.12] pb-3.5 pt-3 text-[13px] leading-[18px] text-danger">
              <CircleAlert aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
              <span dir="auto" className="min-w-0 break-words">{problem.text}</span>
            </div>
          )}
        </div>
        {!settled && (confirm || cancel) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {confirm && <WidgetButton actionRef="confirm" label={confirm.label} look="primary" />}
            {cancel && <WidgetButton actionRef="cancel" label={cancel.label} look="outline" />}
          </div>
        )}
        <span role="status" className="sr-only">{pending !== undefined ? t("widget.sending") : sent !== undefined ? t("widget.sent") : ""}</span>
      </div>
    </WidgetFormProvider>
  );

  if (!settled) return card;
  const detailsId = `${uid}-details`;
  return (
    <AskSettledLine
      ariaLabel={name}
      icon={settled.tone === "cancel" ? <X size={13} /> : undefined}
      action={(
        <button type="button" aria-expanded={details} aria-controls={detailsId} onClick={() => setDetails((open) => !open)} className={ASK_QUIET_BUTTON}>
          {details ? t("question.hideDetails") : t("question.details")}
        </button>
      )}
      // the card as it was answered, read-only: nothing in it takes a press
      detail={details && <div id={detailsId} className="mt-2">{card}</div>}
    >
      <span dir="auto">{settled.label}</span>
    </AskSettledLine>
  );
}
