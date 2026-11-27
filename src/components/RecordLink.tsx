// A record of a connected product in a bot's message (#4507): the chip, and
// the card it opens. The chip is the pill GitHub references wear
// (ref-pill.ts) with the product's mark; the card is the existing HoverCard
// (LinkHoverCard.tsx) asking for its pin, its warm switch and its motion, and
// placed in the window: the opened card is the record window, which places
// itself in the app's window (src/lib/record-window-layout.ts), never against
// its chip.
// Nothing here navigates, and the chip is a button with no address: the link's
// own scheme is never handed to the shell, shown in a status bar, copied as a
// link address or opened by a middle click (a thread reference is the same).
import { useCallback, useRef, useState, type ReactNode } from "react";
import { FileText } from "lucide-react";

import { RecordCard, RecordProductMark } from "@/components/RecordCard";
import { useRecordDetail } from "@/components/useRecordDetail";
import { cn } from "@/lib/cn";
import { HoverCard } from "@/components/LinkHoverCard";
import { REF_PILL_CLASS } from "@/components/ref-pill";
import { openExternalLink } from "@/lib/app-links";
import { focusComposer } from "@/lib/composer-focus";
import { appendComposerDraft } from "@/lib/drafts";
import { activeLocale, t } from "@/lib/i18n";
import { isGuid } from "@/lib/record-card-format";
import { signInAgainPath } from "@/lib/sign-in-again";
import { useSharedPersonProducts } from "@/lib/person-products";
import { findRecordKind, peekRecordCard, prefetchRecordCard, readRecordCard, recordKindName, useRecordCard } from "@/lib/record-cards";
import { placeRecordWindow, recordWindowType } from "@/lib/record-window-layout";
import { TicketWindow } from "@/components/record-window/ticket/TicketWindow";
import { accountWindow } from "@/components/record-window/account/AccountWindow";
import type { AccountTab } from "@/components/record-window/account/account-model";
import { boardWindow, type BoardView } from "@/components/record-window/board/BoardWindow";
import { invoiceWindow, type InvoiceView } from "@/components/record-window/invoice/InvoiceWindow";
import { usePluginWindow } from "@/components/record-window/plugins/PluginWindow";
import { useStoreOptional } from "@/state/store";
import { recordKey, recordMarkdown, type RecordRef } from "../../shared/record-cards";

/** The text a link's children spell (a label is plain text). */
export function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (node && typeof node === "object" && "props" in node) return nodeText((node as { props: { children?: ReactNode } }).props.children);
  return "";
}

/** Open the record in its product: the kept card's address, else one read. */
async function openRecordInProduct(record: RecordRef): Promise<void> {
  const kept = peekRecordCard(record).answer;
  const answer = kept && "card" in kept ? kept : await readRecordCard(record);
  if ("card" in answer && answer.card.openUrl) await openExternalLink(answer.card.openUrl);
}

/** `draftId` is the composer of the surface the message is on (a bot's chat or
 * a room): "Ask" writes there; without one the action is not offered. */
export function RecordLink({ record, draftId, children }: { record: RecordRef; draftId?: string; children?: ReactNode }) {
  const products = useSharedPersonProducts();
  const { product, kind } = findRecordKind(products, record);
  const store = useStoreOptional();
  // only to learn that this console cannot serve cards (the chip is then a
  // plain label); nothing is read until the pointer rests on the chip
  const known = useRecordCard(record, { enabled: false });
  const lang = activeLocale();
  const kindName = recordKindName(kind) ?? t("recordCard.kindFallback");
  const label = nodeText(children).trim();
  const text = label && !isGuid(label) ? label : kindName;
  const productInfo = product ? { name: product.name, ...(product.icon?.url ? { iconUrl: product.icon.url } : {}) } : undefined;
  const chipName = t(product ? "recordCard.chipName" : "recordCard.chipNameBare", { kind: kindName, number: text, product: product?.name ?? "" });
  // Schedule me and Dispatch the ticket go to the conversation the record was named in; in a room, to the
  // person's Primary Bot; with neither, they are not offered (nothing would take them)
  const [surface, surfaceBot, surfaceThread] = (draftId ?? "").split(":");
  const askTo = surface === "bot" && surfaceBot ? surfaceBot : store?.state.bots?.find((one) => one.chiefOfStaff && !one.hidden)?.id;
  const askBot = store && askTo ? (text: string) => store.dispatch({ type: "send", botId: askTo, text, ...(surface === "bot" && surfaceThread ? { threadId: surfaceThread } : {}) }) : undefined;
  // a console that cannot serve cards: the chip reads as plain words. The same
  // button stays mounted, so an open card and the focus are not lost under it.
  const plain = known.miss?.state === "unavailable";

  return (
    <HoverCard
      kind="record-card"
      pinnable
      warm
      motion
      trigger="click"
      place={placeRecordWindow}
      label={t("recordCard.dialogName", { kind: kindName, number: text })}
      disabled={plain}
      onIntent={() => prefetchRecordCard(record)}
      card={({ pinned, close, pin }) => (
        <OpenRecordCard
          record={record}
          label={text}
          pinned={pinned}
          pin={pin}
          onClose={close}
          onAsk={draftId ? (ref, words) => { close(); appendComposerDraft(draftId, `${recordMarkdown(words, ref)} `); setTimeout(() => focusComposer(), 0); } : undefined}
          onConnect={store ? () => { close(); store.dispatch({ type: "togglePlugins", open: true, surface: "apps" }); } : undefined}
          onSignIn={() => { void signInAgainPath().then((path) => { if (path) window.location.assign(path); }); }}
          onBotAsk={askBot}
        />
      )}
    >
      {(anchor) => (
        <button
          {...anchor}
          type="button"
          dir="ltr"
          lang={lang}
          aria-label={plain ? undefined : chipName}
          title={plain ? undefined : t("recordCard.chipTitle")}
          aria-disabled={plain ? true : undefined}
          {...(plain ? { "data-record-plain": record.kind } : { "data-record-link": record.kind })}
          className={plain ? "inline cursor-text break-words text-start" : cn(REF_PILL_CLASS, "cursor-pointer")}
          onClick={(event) => {
            // Cmd or Ctrl + click opens the record in its product, as a link would
            if (event.metaKey || event.ctrlKey) {
              event.preventDefault();
              if (!plain) void openRecordInProduct(record);
              return;
            }
            anchor.onClick(event);
          }}
        >
          {plain ? null : product || kind ? <RecordProductMark product={productInfo} className="size-[13px] shrink-0 self-center rounded-[3px]" /> : <FileText size={13} aria-hidden="true" className="shrink-0 self-center text-ink-tertiary" />}
          <span>{text}</span>
        </button>
      )}
    </HoverCard>
  );
}

/** The most cards one chip's card keeps to go back through. */
export const RECORD_TRAIL_MAX = 8;

/** The card, reading while it is on screen; a ticket, a board and an invoice
 * become their own window (record-window/). A record the card names (a
 * company, an invoice's agreement, a ticket, a parent agreement: any kind) opens
 * in this card's place (a card from a card: never two stacked), with a back
 * arrow in the head that returns to the one it replaced. A record of a product
 * the person does not hold stays plain words. */
function OpenRecordCard({ record, label, pinned, pin, onClose, onAsk, onConnect, onSignIn, onBotAsk }: {
  record: RecordRef;
  label: string;
  pinned: boolean;
  pin: () => void;
  onClose: () => void;
  onAsk?: (ref: RecordRef, label: string) => void;
  onConnect?: () => void;
  onSignIn?: () => void;
  /** a request handed to a bot in the chat (Schedule me, Dispatch the ticket, D-20261127-007; an invoice's Send a reminder) */
  onBotAsk?: (text: string) => void;
}) {
  const [trail, setTrail] = useState<Array<{ ref: RecordRef; label: string }>>([]);
  // a card opened by a click stays the opened card while it fades out (never the tooltip's layout for its 120 ms)
  const [opened, setOpened] = useState(pinned);
  if (pinned && !opened) setOpened(true);
  const current = trail.at(-1) ?? { ref: record, label };
  const products = useSharedPersonProducts();
  const { product, kind } = findRecordKind(products, current.ref);
  const read = useRecordCard(current.ref, { enabled: true });
  // a ticket, board or invoice card becomes its window once the card is read; a company
  // and a contact become theirs at once (M-20261127-140). A server without the detail
  // route leaves the original card; an invoice keeps the card's facts in its own layout.
  const { refresh: refreshCard } = read;
  const refKind = current.ref.kind;
  const account = refKind === "company" || refKind === "contact" ? refKind : null;
  const kindWindow = refKind === "ticket" || refKind === "board" || refKind === "invoice" || account !== null;
  const detail = useRecordDetail(current.ref, kindWindow && Boolean(read.card), refreshCard);
  const { refresh: refreshDetail } = detail;
  // each record of the way keeps the tab the person chose, back and forth
  const [tabs, setTabs] = useState<Record<string, AccountTab>>({});
  const key = recordKey(current.ref);
  // a record of another plugin with a window of its own (a threat, a page, a conversation, M-20261127-141)
  const plugin = usePluginWindow({
    record: current.ref, label: current.label, card: read.card, now: Date.now(), ask: onBotAsk,
    compose: onAsk ? () => onAsk(current.ref, current.label) : undefined,
    back: trail.length ? () => setTrail((steps) => steps.slice(0, -1)) : undefined,
    onChanged: refreshCard,
  });
  const refreshPlugin = useRef(plugin.refresh);
  refreshPlugin.current = plugin.refresh;
  const refresh = useCallback(() => { refreshCard(); refreshDetail(); refreshPlugin.current?.(); }, [refreshCard, refreshDetail]);
  const link = recordMarkdown(current.label, current.ref);
  // what the person set in a window (its tab, a board's filters), kept while this card is open:
  // coming back to a record on the way finds it as it was left
  const [views, setViews] = useState<Record<string, unknown>>({});
  const viewKey = recordKey(current.ref);
  const setView = useCallback((view: unknown) => setViews((all) => ({ ...all, [viewKey]: view })), [viewKey]);
  const type = recordWindowType(current.ref);
  const now = Date.now();
  const layout = (() => {
    if (!read.card) return undefined;
    if (current.ref.kind === "ticket") {
      return detail.detail ? {
        body: <TicketWindow card={read.card} detail={detail.detail} type={type} now={now}
          onScheduleMe={onBotAsk ? () => onBotAsk(t("recordWindow.schedule.mePrompt", { record: link })) : undefined}
          onDispatch={onBotAsk ? () => onBotAsk(t("recordWindow.schedule.dispatchPrompt", { record: link })) : undefined} />,
      } : undefined;
    }
    if (current.ref.kind === "board") return detail.detail ? boardWindow({ card: read.card, detail: detail.detail, type, now, view: views[viewKey] as BoardView | undefined, onView: setView }) : undefined;
    if (current.ref.kind === "invoice") {
      return invoiceWindow({ card: read.card, record: current.ref, detail: detail.detail, type, now, view: views[viewKey] as InvoiceView | undefined, onView: setView,
        onRemind: onBotAsk ? () => onBotAsk(t("recordWindow.invoice.remindPrompt", { record: link })) : undefined });
    }
    return undefined;
  })();
  // the way here, from the chip's record to this one (M-20261119-084): a number reads with its kind
  const way = [{ ref: record, label }, ...trail];
  const crumbs = trail.length ? way.map((step, index) => {
    const words = /^#?\d+$/.test(step.label.trim()) ? `${recordKindName(findRecordKind(products, step.ref).kind) ?? t("recordCard.kindFallback")} ${step.label}` : step.label;
    return { label: words, ...(index < way.length - 1 ? { onOpen: () => setTrail((steps) => steps.slice(0, index)) } : {}) };
  }) : undefined;
  return (
    <RecordCard
      key={`${current.ref.product}/${current.ref.kind}/${current.ref.id}`}
      record={current.ref}
      label={current.label}
      kindName={recordKindName(kind)}
      product={product ? { name: product.name, ...(product.icon?.url ? { iconUrl: product.icon.url } : {}) } : undefined}
      read={detail.detail || plugin.layout ? { ...read, refresh } : read}
      window={!read.card ? undefined : account ? accountWindow({
        kind: account, card: read.card, detail: detail.detail, type, now,
        tab: tabs[key], onTab: (tab) => setTabs((now) => ({ ...now, [key]: tab })), idPrefix: `record-${account}-${current.ref.id.replace(/[^A-Za-z0-9_-]/g, "_")}`,
      }) : layout ?? plugin.layout}
      edits={detail.edits}
      titleEdit={detail.title}
      trail={crumbs}
      canOpenRecord={(ref) => Boolean(findRecordKind(products, ref).kind)}
      pinned={opened}
      onClose={onClose}
      onAsk={onAsk ? () => onAsk(current.ref, current.label) : undefined}
      onConnect={onConnect}
      onSignIn={onSignIn}
      onOpenRecord={(ref, words) => {
        pin();
        setTrail((steps) => {
          // a record already on the way (the root card included) is gone back to, never pushed again
          const way = [{ ref: record, label }, ...steps];
          const at = way.findIndex((step) => step.ref.product === ref.product && step.ref.kind === ref.kind && step.ref.id === ref.id);
          if (at >= 0) return steps.slice(0, at);
          return [...steps, { ref, label: words }].slice(-RECORD_TRAIL_MAX);
        });
      }}
      onBack={trail.length ? () => setTrail((steps) => steps.slice(0, -1)) : undefined}
    />
  );
}
