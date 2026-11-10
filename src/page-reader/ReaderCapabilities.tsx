// What the page may read, in the reader's bar (#3413 lot 1b): nothing the
// page can use is invisible. A button (only when this version declares a
// capability) opens the list: the data it reads with the reader's own
// access, the reader's name and role, opening links and chats. The same
// popover carries the organization's Ask first card and the confirmation of
// a link the page asks to open that no data answer named: the page is
// outside, the reader clicks here. In the page's person's look (reader.css).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Eye, Link2, ShieldQuestion, X } from "lucide-react";

import { pageCapabilitiesAny } from "../../shared/page-capabilities";
import { readerText, type ReaderBoot, type ReaderStringKey } from "../../shared/page-reader";
import type { CapabilityBroker } from "./capabilities";

export function ReaderCapabilities({ boot, broker }: { boot: ReaderBoot; broker: CapabilityBroker }) {
  const state = useSyncExternalStore(broker.subscribe, broker.getState, broker.getState);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const text = (key: ReaderStringKey, values?: Record<string, string>) => readerText(boot.lang, key, values);
  const pending = state.approvals.length + state.links.length;
  const close = useCallback(() => setOpen(false), []);
  const shown = open || pending > 0;
  useEffect(() => {
    if (!shown) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && !ref.current?.contains(target) && !target.closest("[data-reader-caps]")) close();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [shown, close]);
  const caps = state.caps;
  // a page that declares nothing shows nothing: the bar is as it was
  if (!pageCapabilitiesAny(caps)) return null;
  const reads = caps.data.map((name) => state.reads.find((entry) => entry.name === name)?.label ?? name);
  return (
    <div className="sr-anchor sr-anchor-caps">
      <button type="button" className="sr-bar-button" data-reader-caps aria-expanded={shown} aria-haspopup="dialog" aria-label={text("capReads")} title={text("capReadsHint")} onClick={() => setOpen((value) => !value)}>
        <Eye size={14} aria-hidden="true" />
        <span className="sr-bar-label">{text("capReads")}</span>
      </button>
      {shown && (
        <div ref={ref} role="dialog" aria-label={text("capTitle")} data-page-caps-panel className="sr-popover">
          <div className="sr-popover-head">
            <h2>{text("capTitle")}</h2>
            {pending === 0 && <button type="button" className="sr-icon-button" aria-label={text("close")} onClick={close}><X size={15} aria-hidden="true" /></button>}
          </div>
          <ul className="sr-people sr-cap-list">
            {reads.map((label) => <li key={label} className="sr-row" data-cap-read><span className="sr-row-text"><span>{label}</span></span></li>)}
            {caps.viewer && <li className="sr-row" data-cap-viewer><span className="sr-row-text"><span>{text("capViewer")}</span></span></li>}
            {caps.open && <li className="sr-row" data-cap-open><span className="sr-row-text"><span>{text("capOpen")}</span></span></li>}
          </ul>
          <p className="sr-muted sr-cap-scope">{text("capScope")}</p>
          {state.approvals.map((entry) => (
            <div key={entry.id} className="sr-confirm sr-cap-card" role="alert" data-cap-approval={entry.name}>
              <span className="sr-cap-card-title"><ShieldQuestion size={14} aria-hidden="true" />{text("capAsk")}</span>
              <span>{text("capAskWhat", { what: entry.label })}</span>
              <div className="sr-confirm-actions">
                <button type="button" className="sr-button sr-button-small" data-cap-decline onClick={() => broker.resolveApproval(entry.id, "decline")}>{text("decline")}</button>
                <button type="button" className="sr-button sr-button-small" data-cap-always onClick={() => broker.resolveApproval(entry.id, "always")}>{text("capAlways")}</button>
                <button type="button" className="sr-button sr-button-small sr-button-primary" data-cap-allow onClick={() => broker.resolveApproval(entry.id, "once")}>{text("capAllow")}</button>
              </div>
            </div>
          ))}
          {state.links.map((entry) => (
            <div key={entry.id} className="sr-confirm sr-cap-card" role="alert" data-cap-link>
              <span className="sr-cap-card-title"><Link2 size={14} aria-hidden="true" />{text("capLinkTitle")}</span>
              <code className="sr-cap-url" title={entry.url}>{entry.host}</code>
              <span>{text("capLinkNote")}</span>
              <div className="sr-confirm-actions">
                <button type="button" className="sr-button sr-button-small" data-cap-link-cancel onClick={() => broker.resolveLink(entry.id, false)}>{text("cancel")}</button>
                <button type="button" className="sr-button sr-button-small sr-button-primary" data-cap-link-open onClick={() => broker.resolveLink(entry.id, true)}>{text("capLinkOpen")}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
