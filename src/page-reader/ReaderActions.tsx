// The actions on the right of the reader's bar: who else has the page open
// (avatars) and Annotate for anyone signed in who may read the page,
// Download PDF for every reader, Page state and Share only for the page's
// own person (the server tells, shared/page-reader.ts ReaderBoot.can). In
// the page's person's look (reader.css); on a phone each keeps its icon and
// its name as its accessible label.
import { useCallback, useEffect, useState } from "react";
import { FileDown, MessageSquareText, Share2 } from "lucide-react";

import { readerText, type ReaderBoot } from "../../shared/page-reader";
import { initialsOf } from "@/lib/page-share-plan";
import { AnnotatePanel } from "./AnnotatePanel";
import { othersHere, usePageLive } from "./live";
import type { CapabilityBroker } from "./capabilities";
import { downloadPdf } from "./print";
import { ReaderCapabilities } from "./ReaderCapabilities";
import { ReaderShare } from "./ReaderShare";
import { ReaderStateButton } from "./ReaderState";

/** The panel sits under the bar, whose height can change (a phone wraps it). */
function useBarHeight(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const bar = document.querySelector(".sagax-bar");
    const set = () => document.documentElement.style.setProperty("--sr-bar-h", `${Math.round(bar?.getBoundingClientRect().bottom ?? 52)}px`);
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, [active]);
}

export function ReaderActions({ boot, broker }: { boot: ReaderBoot; broker?: CapabilityBroker | null }) {
  const [sharing, setSharing] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const text = (key: Parameters<typeof readerText>[1], values?: Record<string, string>) => readerText(boot.lang, key, values);
  const frame = typeof document === "undefined" ? null : document.querySelector<HTMLIFrameElement>("iframe");
  useBarHeight(annotating);
  useEffect(() => {
    document.body.classList.toggle("sr-panel-open", annotating);
  }, [annotating]);
  const closePanel = useCallback(() => setAnnotating(false), []);
  const live = usePageLive(boot.can.annotate ? boot.pageId : undefined);
  const others = othersHere(live.people, boot.me?.id);
  return (
    <>
      {others.length > 0 && (
        <div className="sr-presence" data-reader-presence aria-label={text("hereNow", { names: others.map((person) => person.name).join(", ") })}>
          {others.slice(0, 4).map((person) => (
            <span key={person.id} className="sr-presence-avatar" title={person.name}>{initialsOf(person.name)}</span>
          ))}
          {others.length > 4 && <span className="sr-presence-avatar sr-presence-more" title={others.slice(4).map((person) => person.name).join(", ")}>+{others.length - 4}</span>}
        </div>
      )}
      {broker && <ReaderCapabilities boot={boot} broker={broker} />}
      <button type="button" className="sr-bar-button" data-reader-pdf aria-label={text("pdf")} title={text("pdfHint")} onClick={downloadPdf}>
        <FileDown size={14} aria-hidden="true" />
        <span className="sr-bar-label">{text("pdf")}</span>
      </button>
      {boot.can.annotate && boot.pageId && (
        <button type="button" className="sr-bar-button" data-reader-annotate aria-pressed={annotating} aria-label={text("annotate")} title={text("annotateHint")} onClick={() => setAnnotating((open) => !open)}>
          <MessageSquareText size={14} aria-hidden="true" />
          <span className="sr-bar-label">{text("annotate")}</span>
        </button>
      )}
      {annotating && boot.pageId && <AnnotatePanel boot={boot} pageId={boot.pageId} frame={frame} changes={live.changes} onClose={closePanel} />}
      {boot.can.share && boot.pageId && <ReaderStateButton boot={boot} pageId={boot.pageId} />}
      {boot.can.share && boot.pageId && (
        <div className="sr-anchor">
          <button type="button" className="sr-bar-button sr-bar-button-primary" data-reader-share aria-expanded={sharing} aria-haspopup="dialog" aria-label={text("share")} title={text("share")} onClick={() => setSharing((open) => !open)}>
            <Share2 size={14} aria-hidden="true" />
            <span className="sr-bar-label">{text("share")}</span>
            <svg className="sr-bar-chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
          {sharing && <ReaderShare boot={boot} pageId={boot.pageId} onClose={() => setSharing(false)} />}
        </div>
      )}
    </>
  );
}
