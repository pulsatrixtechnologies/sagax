// A record of a connected product in a bot's message (#4507): the chip, and
// the card it opens. The chip is the pill GitHub references wear
// (ref-pill.ts) with the product's mark; the card is the existing HoverCard
// (LinkHoverCard.tsx) asking for its pin, its warm switch and its motion.
// Nothing here navigates: the link's own scheme is never handed to the shell.
import { useState, type ReactNode } from "react";
import { FileText } from "lucide-react";

import { RecordCard, RecordProductMark } from "@/components/RecordCard";
import { HoverCard } from "@/components/LinkHoverCard";
import { REF_PILL_CLASS } from "@/components/ref-pill";
import { openExternalLink } from "@/lib/app-links";
import { focusComposer } from "@/lib/composer-focus";
import { appendComposerDraft } from "@/lib/drafts";
import { activeLocale, t } from "@/lib/i18n";
import { isGuid } from "@/lib/record-card-format";
import { signInAgainPath } from "@/lib/sign-in-again";
import { findRecordKind, peekRecordCard, prefetchRecordCard, readRecordCard, recordKindName, useRecordCard, useRecordProducts } from "@/lib/record-cards";
import { useStoreOptional } from "@/state/store";
import { recordLink, recordMarkdown, type RecordRef } from "../../shared/record-cards";

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

export function RecordLink({ record, botId, threadId, children }: { record: RecordRef; botId?: string; threadId?: string; children?: ReactNode }) {
  const products = useRecordProducts();
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
  const draftId = botId && threadId ? `bot:${botId}:${threadId}` : null;
  if (known.miss?.state === "unavailable") return <span className="break-words">{children}</span>;

  return (
    <HoverCard
      kind="record-card"
      pinnable
      warm
      motion
      label={t("recordCard.dialogName", { kind: kindName, number: text })}
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
        />
      )}
    >
      {(anchor) => (
        <a
          {...anchor}
          href={recordLink(record)}
          dir="ltr"
          lang={lang}
          aria-label={chipName}
          data-record-link={record.kind}
          className={REF_PILL_CLASS}
          onClick={(event) => {
            // Cmd or Ctrl + click opens the record in its product, as any link would
            if (event.metaKey || event.ctrlKey) {
              event.preventDefault();
              void openRecordInProduct(record);
              return;
            }
            anchor.onClick(event);
          }}
        >
          {product || kind ? <RecordProductMark product={productInfo} className="size-[13px] shrink-0 self-center rounded-[3px]" /> : <FileText size={13} aria-hidden="true" className="shrink-0 self-center text-ink-tertiary" />}
          <span>{text}</span>
        </a>
      )}
    </HoverCard>
  );
}

/** The card, reading while it is on screen. A company the card names opens
 * in this card's place (a card from a card: never two stacked), with a back
 * arrow in the head that returns to the one it replaced. */
function OpenRecordCard({ record, label, pinned, pin, onClose, onAsk, onConnect, onSignIn }: {
  record: RecordRef;
  label: string;
  pinned: boolean;
  pin: () => void;
  onClose: () => void;
  onAsk?: (ref: RecordRef, label: string) => void;
  onConnect?: () => void;
  onSignIn?: () => void;
}) {
  const [trail, setTrail] = useState<Array<{ ref: RecordRef; label: string }>>([]);
  const current = trail.at(-1) ?? { ref: record, label };
  const products = useRecordProducts();
  const { product, kind } = findRecordKind(products, current.ref);
  const read = useRecordCard(current.ref, { enabled: true });
  return (
    <RecordCard
      key={`${current.ref.product}/${current.ref.kind}/${current.ref.id}`}
      record={current.ref}
      label={current.label}
      kindName={recordKindName(kind)}
      product={product ? { name: product.name, ...(product.icon?.url ? { iconUrl: product.icon.url } : {}) } : undefined}
      read={read}
      pinned={pinned}
      onClose={onClose}
      onAsk={onAsk ? () => onAsk(current.ref, current.label) : undefined}
      onConnect={onConnect}
      onSignIn={onSignIn}
      onOpenRecord={(ref, words) => {
        if (current.ref.product === ref.product && current.ref.kind === ref.kind && current.ref.id === ref.id) return;
        pin();
        setTrail((steps) => [...steps, { ref, label: words }]);
      }}
      onBack={trail.length ? () => setTrail((steps) => steps.slice(0, -1)) : undefined}
    />
  );
}
