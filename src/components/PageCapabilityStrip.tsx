// The app's side of a page's capabilities (#3413 lot 1b): the same broker as
// the reading link's bar (src/page-reader/capabilities.ts), here for the open
// page and its preview. It answers the page's messages with the person's own
// session, and shows, in the strip under the header, what the page may read,
// the organization's Ask first card and the confirmation of a link the page
// asks to open that no data answer named. The page is outside: the click is
// here.
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Link2, ShieldQuestion } from "lucide-react";

import { t } from "@/lib/i18n";
import { openExternalLink } from "@/lib/app-links";
import { capabilityLine } from "@/lib/page-capabilities-line";
import { api, openBot, openThread, useStore } from "@/state/store";
import { pageCapabilitiesAny } from "../../shared/page-capabilities";
import { createCapabilityBroker, type CapabilityBroker } from "../page-reader/capabilities";

/** The open page's broker: one per drawn version, listening on this window.
 * The page's calls reach this window through the preview wrapper's relay
 * (PREVIEW_CAP_RELAY_SOURCE): `preview` is that wrapper's iframe, `frame` the
 * page's own frame inside it (the open-link messages come from there). */
export function usePageCapabilityBroker(input: { pageId: string; drawn: string; version?: number; preview(): HTMLIFrameElement | null; frame(): Window | null }): CapabilityBroker {
  const { state, dispatch } = useStore();
  // the broker lives as long as the drawn version; it reads the app state as it is when asked
  const here = useRef(state);
  here.current = state;
  const broker = useMemo(() => createCapabilityBroker({
    frame: () => input.preview()?.contentWindow ?? null,
    frameOrigin: () => { try { return new URL(input.preview()?.src ?? "", location.href).origin; } catch { return ""; } },
    openFrame: input.frame,
    ...(input.version !== undefined ? { version: input.version } : {}),
    api: <T,>(path: string, init?: { method: "POST"; body: unknown }) => api<T>(path, init ? { method: init.method, body: JSON.stringify(init.body) } : undefined),
    pageId: input.pageId,
    signedIn: true,
    lang: typeof document !== "undefined" && document.documentElement.lang.startsWith("en") ? "en" : "fr",
    openUrl: (url) => { void openExternalLink(url).catch(() => undefined); },
    openRef: (ref) => {
      if (ref.threadId) return openThread(dispatch, { botId: ref.botId, threadId: ref.threadId }, here.current, false);
      const bot = here.current.bots.find((entry) => entry.id === ref.botId);
      if (!bot) return false;
      openBot(dispatch, bot, false);
      return true;
    },
  }), [input.pageId, input.drawn, dispatch]);
  useEffect(() => {
    void broker.start();
    // coming back to the window: the page reads what it had read again (no timer)
    const onFocus = () => broker.refocused();
    const onVisible = () => { if (document.visibilityState === "visible") broker.refocused(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [broker]);
  return broker;
}

/** Whether the strip has something to say (so the caller keeps its room). */
export function useCapabilityStripVisible(broker: CapabilityBroker): boolean {
  const state = useSyncExternalStore(broker.subscribe, broker.getState, broker.getState);
  return pageCapabilitiesAny(state.caps);
}

export function PageCapabilityStrip({ broker }: { broker: CapabilityBroker }) {
  const state = useSyncExternalStore(broker.subscribe, broker.getState, broker.getState);
  if (!pageCapabilitiesAny(state.caps)) return null;
  const line = capabilityLine(state.caps);
  return (
    <div data-page-caps-strip>
      {line && <p role="status" title={t("pages.caps.title")} className="truncate border-y border-hairline/30 px-3 py-1.5 text-[12px] text-ink-secondary">{line}</p>}
      {state.approvals.map((entry) => (
        <div key={entry.id} role="alert" data-cap-approval={entry.name} className="flex flex-wrap items-center gap-2 border-b border-hairline/30 bg-accent/10 px-3 py-1.5 text-[12px] text-ink">
          <ShieldQuestion size={14} aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 flex-1">{t("pages.caps.ask", { what: entry.label })}</span>
          <button type="button" data-cap-decline className="rounded px-1.5 py-1 text-ink-secondary hover:bg-hover" onClick={() => broker.resolveApproval(entry.id, "decline")}>{t("pages.decline")}</button>
          <button type="button" data-cap-always className="rounded px-1.5 py-1 text-accent hover:bg-hover" onClick={() => broker.resolveApproval(entry.id, "always")}>{t("pages.caps.always")}</button>
          <button type="button" data-cap-allow className="rounded px-1.5 py-1 text-accent hover:bg-hover" onClick={() => broker.resolveApproval(entry.id, "once")}>{t("pages.caps.allow")}</button>
        </div>
      ))}
      {state.links.map((entry) => (
        <div key={entry.id} role="alert" data-cap-link className="flex flex-wrap items-center gap-2 border-b border-hairline/30 bg-accent/10 px-3 py-1.5 text-[12px] text-ink">
          <Link2 size={14} aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 flex-1 break-all" title={entry.url}>{t("pages.caps.link", { host: entry.host })}</span>
          <button type="button" data-cap-link-cancel className="rounded px-1.5 py-1 text-ink-secondary hover:bg-hover" onClick={() => broker.resolveLink(entry.id, false)}>{t("pages.cancel")}</button>
          <button type="button" data-cap-link-open className="rounded px-1.5 py-1 text-accent hover:bg-hover" onClick={() => broker.resolveLink(entry.id, true)}>{t("pages.caps.linkOpen")}</button>
        </div>
      ))}
    </div>
  );
}
