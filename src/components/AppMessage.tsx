// A bot-authored live app in the transcript (message kind "app"): a page of
// HTML an MCP App pushed with show_html and replaces in place with
// update_html. It is drawn in the SAME sandboxed frame as a ```widget
// (src/lib/rich-blocks.ts): an iframe sandboxed to "allow-scripts" only, so
// it has an opaque origin and cannot read this app, its storage, its cookies
// or its tokens; a Content Security Policy that forbids every network request
// (connect-src 'none'); no forms, popups, top navigation, downloads or nested
// frames. The only channel back without a declaration is a height number the
// parent clamps. A page that declares capabilities also gets the published
// page's postMessage bridge (window.sagax). The host calls the server with
// the viewer's session. The page is untrusted content: nothing here widens
// that sandbox.
//
// A live update is a new revision: the frame is keyed by it, so an update is
// a clean remount, never a reload mistaken for the page navigating away. A
// skin change is posted to the frame instead of reloading it, so a running
// app keeps its state across a theme change.
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import geistLatin from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline";

import { activeLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { buildWidgetDocument, clampWidgetHeight, WIDGET_MESSAGE } from "@/lib/rich-blocks";
import { acceptWidgetOpen } from "@/lib/sandboxed-open";
import { widgetFontFace, type WidgetTheme } from "@/lib/widget-kit";
import type { Message } from "@/state/store";
import { api } from "@/state/store/api";
import { pageCapabilitiesAny, pageCapabilitiesOf } from "../../shared/page-capabilities";
import { readerText } from "../../shared/page-reader";
import { capabilityBridgeSource } from "../../server/pages/published-pages-render.ts";
import { createAppConnectorBroker, type AppCapCard } from "./app-connector-broker";
import { postWidgetTheme, useWidgetTheme, widgetFrameAttributes } from "./WidgetFrame";
import { WidgetCardFrame } from "./widget/WidgetCardFrame";

const DEFAULT_HEIGHT = 160;
const FONT_FACE = widgetFontFace(geistLatin);
const NO_CARDS: readonly AppCapCard[] = [];
const noCards = () => NO_CARDS;
const noSubscribe = () => () => {};

function SandboxedAppFrame({ srcDoc, title, theme, onEscaped, hostFrame, onReady }: {
  srcDoc: string;
  title: string;
  theme: WidgetTheme;
  onEscaped: () => void;
  hostFrame?: { current: HTMLIFrameElement | null };
  onReady?: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const loads = useRef(0);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  // a skin change after load: the frame swaps its theme rule in place
  useEffect(() => {
    postWidgetTheme(frame.current, theme);
  }, [theme]);

  useEffect(() => {
    loads.current = 0;
    const onMessage = (event: MessageEvent) => {
      const source = frame.current?.contentWindow;
      if (acceptWidgetOpen(event, source)) return;
      if (event.source !== source) return;
      const data = event.data as { type?: unknown; height?: unknown } | null;
      if (!data || data.type !== WIDGET_MESSAGE) return;
      const next = clampWidgetHeight(data.height);
      if (next !== null) setHeight(next);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [srcDoc]);

  return (
    <iframe
      ref={(node) => {
        frame.current = node;
        if (hostFrame) hostFrame.current = node;
      }}
      {...widgetFrameAttributes(srcDoc, title)}
      onLoad={() => {
        postWidgetTheme(frame.current, themeRef.current);
        loads.current += 1;
        // the first load is our srcdoc; any later one is the app navigating
        // its own frame, the one thing a sandbox cannot forbid
        if (loads.current > 1) onEscaped();
        readyRef.current?.();
      }}
      style={{ height, colorScheme: theme.scheme }}
      className="block w-full border-0 bg-transparent"
    />
  );
}

function AppMessageComponent({ message, botId, threadId }: { message: Message; botId?: string; threadId?: string }) {
  const payload = message.app;
  const frameRef = useRef<HTMLDivElement>(null);
  const hostFrame = useRef<HTMLIFrameElement | null>(null);
  const theme = useWidgetTheme(frameRef);
  const firstTheme = useRef(theme);
  const [escapes, setEscapes] = useState(0);
  const html = payload?.html ?? "";
  const caps = useMemo(() => pageCapabilitiesOf(html), [html]);
  const lang = activeLocale().toLowerCase().startsWith("fr") ? "fr" as const : "en" as const;
  // built once per page: a skin change is posted to the frame, not reloaded.
  // The bridge is the published page's, and only when this HTML declares a capability.
  const srcDoc = useMemo(
    () => buildWidgetDocument(html, firstTheme.current, FONT_FACE, pageCapabilitiesAny(caps) ? capabilityBridgeSource(caps) : ""),
    [html, caps],
  );
  const broker = useMemo(() => {
    if (!botId || !threadId || !pageCapabilitiesAny(caps)) return null;
    return createAppConnectorBroker({
      frame: () => hostFrame.current?.contentWindow ?? null,
      api: (path, init) => api(path, { method: "POST", ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }) }),
      botId,
      threadId,
      messageId: message.id,
      caps,
      lang,
      signedIn: true,
    });
  }, [botId, threadId, caps, lang, message.id]);

  useEffect(() => {
    if (!broker) return;
    const onMessage = (event: MessageEvent) => { void broker.onMessage(event); };
    window.addEventListener("message", onMessage);
    broker.start();
    return () => window.removeEventListener("message", onMessage);
  }, [broker]);

  const cards = useSyncExternalStore(broker ? broker.subscribe : noSubscribe, broker ? broker.getCards : noCards, broker ? broker.getCards : noCards);

  // a row with no page to draw still reads as its text
  if (!payload || typeof payload.html !== "string" || payload.html.trim() === "") {
    return message.text
      ? <div className="chat-text w-fit max-w-[min(42rem,78%)] rounded-2xl bg-card px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-ink">{message.text}</div>
      : null;
  }

  const title = payload.title?.trim() || t("app.title");
  const blocked = escapes >= 2;

  return (
    <div ref={frameRef} dir="ltr" className={cn("my-2 min-w-0")}>
      <WidgetCardFrame
        // an update is a new revision: remount the frame so it is a clean
        // replace, and reset the escape count with it
        key={payload.rev ?? 0}
        label={title}
        title={title}
        meta={t("app.live")}
        size="lg"
        flush
        fallbackText={message.text ?? title}
        problem={escapes > 0 ? (blocked ? t("app.blocked") : t("app.escaped")) : undefined}
      >
        {blocked
          ? <p role="status" className="px-4 py-3 text-[12px] text-ink-secondary">{t("app.blocked")}</p>
          : <SandboxedAppFrame srcDoc={srcDoc} title={title} theme={theme} onEscaped={() => setEscapes((value) => value + 1)} hostFrame={hostFrame} onReady={() => broker?.start()} />}
        {cards.map((card) => (
          <div key={card.id} role="alert" data-app-cap-approval={card.name} className="border-t border-border px-4 py-3 text-[13px]">
            <p className="font-medium">{readerText(lang, card.by === "page" ? "capAct" : card.by === "person" ? "capOwnAsk" : "capAsk")}</p>
            <p>{readerText(lang, "capActWhat", { what: card.label })}</p>
            <div className="mt-2 flex gap-2">
              <button type="button" data-app-cap-decline className="rounded px-2 py-1 text-[12px] text-ink-secondary hover:bg-hover" onClick={() => broker?.resolveApproval(card.id, "decline")}>{readerText(lang, "decline")}</button>
              {card.always && <button type="button" data-app-cap-always className="rounded px-2 py-1 text-[12px] text-accent hover:bg-hover" onClick={() => broker?.resolveApproval(card.id, "always")}>{readerText(lang, "capAlways")}</button>}
              <button type="button" data-app-cap-allow className="rounded px-2 py-1 text-[12px] text-accent hover:bg-hover" onClick={() => broker?.resolveApproval(card.id, "once")}>{readerText(lang, "capAllow")}</button>
            </div>
          </div>
        ))}
      </WidgetCardFrame>
    </div>
  );
}

export const AppMessage = memo(AppMessageComponent);
