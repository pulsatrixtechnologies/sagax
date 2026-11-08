import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, Copy, PictureInPicture2, SquareTerminal, X } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import { terminalDurationLabel, type TerminalEmbed } from "../../../shared/terminal-resources.ts";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { closeFloating, openFloating, useFloatingOpen } from "@/lib/floating-windows";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";
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

/** Where the card's message lives, so folding it is saved on the message. */
export interface TerminalEmbedOwner {
  botId: string;
  threadId: string;
  messageId: string;
}

/** The card's title: "Remote session" for a remote computer, else its label. */
export function terminalEmbedLabel(embed: TerminalEmbed): string {
  return embed.provider === "tailcat" ? t("remoteSession.terminal") : embed.label;
}

/** The folded row: "Remote session · DEVJC-FS-01 · Ended · 4 min". */
export function terminalFoldedLabel(embed: TerminalEmbed, status: "connecting" | "live" | "ended"): string {
  const duration = status === "ended" ? terminalDurationLabel(embed.openedAt, embed.endedAt) : "";
  return [
    terminalEmbedLabel(embed),
    embed.hostLabel,
    status === "live" ? t("terminal.status.live") : t("terminal.status.ended"),
    duration,
  ].filter(Boolean).join(" · ");
}

/** Folded at first: the message says so, else an ended session is folded. */
export function terminalStartsFolded(embed: TerminalEmbed): boolean {
  return embed.collapsed ?? embed.status === "ended";
}

/** Saves the fold on the message (fire and forget: the card already moved). */
export function persistTerminalFold(owner: TerminalEmbedOwner, collapsed: boolean): Promise<unknown> {
  return api(`/api/bots/${encodeURIComponent(owner.botId)}/terminal-embeds/${encodeURIComponent(owner.messageId)}`, {
    method: "PATCH",
    body: JSON.stringify({ threadId: owner.threadId, collapsed }),
  }).catch(() => undefined);
}

/** Ends the shell (the same call the widget makes when it lets go). */
export function endTerminalSession(sessionId: string): Promise<unknown> {
  return api(`/api/terminal/sessions/${encodeURIComponent(sessionId)}/close`, { method: "POST" }).catch(() => undefined);
}

export function TerminalChatEmbed({ embed, owner }: { embed: TerminalEmbed; owner?: TerminalEmbedOwner }) {
  const session = embed.status === "ended" ? null : terminalSession(embed.sessionId);
  const state = useSessionState(session);
  const windowId = terminalWindowId(embed.sessionId);
  const detached = useFloatingOpen(windowId);
  const status = !session ? "ended" : state.status === "connecting" ? embed.status : state.status;
  const label = terminalEmbedLabel(embed);
  const title = `${label} · ${embed.hostLabel}`;
  const [collapsed, setCollapsed] = useState(() => terminalStartsFolded(embed));

  // the chat row holds the session while it is mounted, even detached
  useEffect(() => session?.retain(), [session]);
  // a session that ended closes its window
  useEffect(() => {
    if (status === "ended") closeFloating(windowId);
  }, [status, windowId]);
  // a session ending here (exit, logout, End) folds the card instead of
  // leaving a big empty terminal; the server saves the fold on the message
  const lastStatus = useRef(status);
  useEffect(() => {
    if (lastStatus.current !== "ended" && status === "ended") setCollapsed(true);
    lastStatus.current = status;
  }, [status]);
  // the saved fold (another tab, the server folding an ended session) wins
  useEffect(() => {
    if (embed.collapsed !== undefined) setCollapsed(embed.collapsed);
  }, [embed.collapsed]);

  const fold = (next: boolean) => {
    setCollapsed(next);
    if (owner) void persistTerminalFold(owner, next);
  };
  const close = () => {
    if (session && status !== "ended") {
      closeFloating(windowId);
      void endTerminalSession(embed.sessionId);
    }
    fold(true);
  };

  const copySelection = () => {
    const selection = session?.getSelection() || (!session ? embed.transcript : "");
    if (selection) void copyText(selection);
  };

  if (collapsed) {
    return (
      <button
        type="button"
        data-terminal-embed=""
        data-terminal-folded="true"
        aria-expanded={false}
        title={t("terminal.expand")}
        onClick={() => fold(false)}
        className="group mt-2 flex h-9 w-full min-w-0 items-center gap-2 rounded-xl border border-hairline/40 bg-card px-3 text-left text-[12.5px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:transition-none"
      >
        <SquareTerminal size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary group-hover:text-ink-secondary" />
        <span data-terminal-folded-label="" className="min-w-0 flex-1 truncate">{terminalFoldedLabel(embed, status)}</span>
        <ChevronDown size={15} aria-hidden="true" className="shrink-0 text-ink-tertiary group-hover:text-ink-secondary" />
      </button>
    );
  }

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
    <div className="mt-2 overflow-hidden rounded-xl border border-hairline/40 bg-[#0d1117] text-ink" data-terminal-embed="" data-terminal-folded="false">
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
        <button
          type="button"
          className="rounded p-1 hover:bg-white/10"
          title={status === "ended" ? t("terminal.close") : t("terminal.endAndClose")}
          aria-label={status === "ended" ? t("terminal.close") : t("terminal.endAndClose")}
          data-terminal-close={status === "ended" ? "fold" : "end"}
          onClick={close}
        >
          <X size={14} />
        </button>
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
      ) : embed.transcript ? (
        <pre data-terminal-transcript="" className="max-h-[min(320px,40vh)] w-full overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[12px] leading-[1.45] text-[#e6edf3]">{embed.transcript}</pre>
      ) : (
        <p data-terminal-transcript="" className="px-3 py-3 text-[12px] text-white/60">{t("terminal.noOutput")}</p>
      )}
    </div>
  );
}
