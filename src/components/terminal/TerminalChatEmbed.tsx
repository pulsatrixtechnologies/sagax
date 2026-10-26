import { useEffect, useRef, useSyncExternalStore } from "react";
import { Copy, PictureInPicture2 } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import type { TerminalEmbed } from "../../../shared/terminal-resources.ts";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { closeFloating, openFloating, useFloatingOpen } from "@/lib/floating-windows";
import { t } from "@/lib/i18n";
import { terminalSession, type TerminalSession, type TerminalSessionState } from "./terminal-session";

/** The floating window of a terminal session: one per session. */
export const terminalWindowId = (sessionId: string) => `terminal:${sessionId}`;

const ENDED: TerminalSessionState = { status: "ended", error: null };
const noop = () => () => {};

function useSessionState(session: TerminalSession | null): TerminalSessionState {
  return useSyncExternalStore(session ? session.subscribe : noop, () => session?.state() ?? ENDED, () => session?.state() ?? ENDED);
}

/** Shows a session's terminal in this element while mounted. */
function TerminalSurface({ session, className }: { session: TerminalSession; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const release = session.retain();
    const detach = session.attach(host);
    return () => {
      detach();
      release();
    };
  }, [session]);
  return <div ref={ref} className={className} />;
}

function TerminalWindowBody({ session }: { session: TerminalSession }) {
  return <TerminalSurface session={session} className="h-full w-full bg-[#0d1117] px-1 py-1" />;
}

export function TerminalChatEmbed({ embed }: { embed: TerminalEmbed }) {
  const session = embed.status === "ended" ? null : terminalSession(embed.sessionId);
  const state = useSessionState(session);
  const windowId = terminalWindowId(embed.sessionId);
  const detached = useFloatingOpen(windowId);
  const status = !session ? "ended" : state.status === "connecting" ? embed.status : state.status;
  const label = embed.provider === "tailcat" ? t("remoteSession.terminal") : embed.label;
  const title = `${label} · ${embed.hostLabel}`;

  // the chat row holds the session while it is mounted, even detached
  useEffect(() => session?.retain(), [session]);
  // a session that ended closes its window
  useEffect(() => {
    if (status === "ended") closeFloating(windowId);
  }, [status, windowId]);

  const copySelection = () => {
    const selection = session?.getSelection();
    if (selection) void copyText(selection);
  };

  const detach = () => {
    if (!session) return;
    const release = session.retain();
    openFloating({
      id: windowId,
      kind: "terminal",
      title,
      size: { width: 760, height: 440 },
      minWidth: 360,
      minHeight: 200,
      render: () => <TerminalWindowBody session={session} />,
      onClose: release,
    });
    session.focus();
  };

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-hairline/40 bg-[#0d1117] text-ink" data-terminal-embed="">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-[12px] text-[#e6edf3]/90">
        <span className="font-medium">{label}</span>
        <span className="text-white/50">·</span>
        <span className="truncate text-white/70">{embed.hostLabel}</span>
        <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11px]", status === "live" ? "bg-emerald-500/20 text-emerald-200" : "bg-white/10 text-white/60")}>
          {status === "live" ? t("terminal.status.live") : t("terminal.status.ended")}
        </span>
        <button type="button" className="rounded p-1 hover:bg-white/10" title={t("terminal.copy")} aria-label={t("terminal.copy")} onClick={copySelection}>
          <Copy size={14} />
        </button>
        {session && status !== "ended" && (
          <button
            type="button"
            className={cn("rounded p-1 hover:bg-white/10", detached && "bg-white/10")}
            title={t("terminal.detach")}
            aria-label={t("terminal.detach")}
            aria-pressed={detached}
            data-terminal-detach=""
            onClick={detached ? () => closeFloating(windowId) : detach}
          >
            <PictureInPicture2 size={14} />
          </button>
        )}
      </div>
      {state.error && <p className="px-3 py-1 text-[12px] text-amber-200">{state.error}</p>}
      {session && detached ? (
        <div className="flex h-[min(320px,40vh)] w-full flex-col items-center justify-center gap-2 text-[12px] text-white/60" data-terminal-detached="">
          <span>{t("terminal.detached")}</span>
          <button type="button" className="rounded-md border border-white/15 px-2.5 py-1 text-[#e6edf3] hover:bg-white/10" onClick={() => closeFloating(windowId)}>
            {t("terminal.attach")}
          </button>
        </div>
      ) : session ? (
        <TerminalSurface session={session} className="h-[min(320px,40vh)] w-full px-1 py-1" />
      ) : (
        <div className="h-[min(320px,40vh)] w-full" />
      )}
    </div>
  );
}
