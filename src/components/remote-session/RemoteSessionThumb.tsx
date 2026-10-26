// The bot panel row's mini screen: the same read-only picture the chat's
// screen card polls (useScreenPoll), small and rounded, refreshed slowly and
// only while the row is on screen. No picture to show (a server without a
// desktop, an OS not known yet, a refused screen, a closed session, or the
// first picture still on its way) draws a placeholder icon instead. A click
// takes control where control exists.
import { useEffect, useRef, useState } from "react";
import { Loader2, Monitor, MonitorOff, Server } from "lucide-react";

import { publicText, type RemoteSessionView } from "../../../shared/remote-session";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { remoteControllable, remoteHasScreen, useScreenPoll } from "./RemoteScreenCard";

/** How often the panel thumbnail is refreshed while visible. */
export const THUMB_POLL_MS = 15000;

export type RemoteThumbKind = "picture" | "loading" | "headless" | "unknown" | "denied" | "closed";

/** What the thumbnail can show for a session, before any picture arrives. */
export function remoteThumbKind(view: RemoteSessionView, shot: string | null): RemoteThumbKind {
  if (view.state !== "connected") return "closed";
  if (view.headless) return "headless";
  if (view.osKnown === false) return "unknown";
  if (view.screenDenied) return "denied";
  return shot ? "picture" : "loading";
}

/** Whether the thumbnail asks the computer for a picture at all. */
export function remoteThumbPolls(view: RemoteSessionView): boolean {
  return remoteHasScreen(view) && view.osKnown !== false && !view.screenDenied;
}

/** True while the element is on screen and the tab is in front. Without
 * IntersectionObserver (tests) it counts as visible. */
function useOnScreen(ref: React.RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(typeof IntersectionObserver === "undefined");
  const [tabVisible, setTabVisible] = useState(typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => setInView(entries.some((entry) => entry.isIntersecting)));
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  useEffect(() => {
    const onChange = () => setTabVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return inView && tabVisible;
}

const BOX = "relative flex h-[44px] w-[70px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-hairline-weak bg-inset text-ink-tertiary";

export function RemoteSessionThumb({ botId, view, onTakeControl }: { botId: string; view: RemoteSessionView; onTakeControl?: () => void }) {
  const ref = useRef<HTMLElement | null>(null);
  const visible = useOnScreen(ref);
  const { shot } = useScreenPoll(botId, view.id, remoteThumbPolls(view) && visible, THUMB_POLL_MS);
  const kind = remoteThumbKind(view, shot);
  const name = publicText(view.hostname) || view.code;
  const Icon = kind === "headless" ? Server : kind === "unknown" || kind === "denied" || kind === "closed" ? MonitorOff : Monitor;
  const content = kind === "picture" && shot ? (
    <img data-remote-thumb-shot="" src={shot} alt="" draggable={false} className="h-full w-full object-cover" />
  ) : kind === "loading" ? (
    <Loader2 size={15} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
  ) : (
    <Icon size={17} aria-hidden="true" />
  );
  const interactive = Boolean(onTakeControl) && remoteControllable(view) && kind !== "headless" && kind !== "closed";
  if (interactive) {
    return (
      <button
        ref={ref as React.RefObject<HTMLButtonElement>}
        type="button"
        data-remote-thumb={kind}
        aria-label={`${t("remoteSession.takeControl")} : ${name}`}
        title={t("remoteSession.takeControl")}
        onClick={onTakeControl}
        className={cn(BOX, "transition-colors hover:border-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:transition-none")}
      >
        {content}
      </button>
    );
  }
  return (
    <div ref={ref as React.RefObject<HTMLDivElement>} data-remote-thumb={kind} role="img" aria-label={name} className={BOX}>
      {content}
    </div>
  );
}
