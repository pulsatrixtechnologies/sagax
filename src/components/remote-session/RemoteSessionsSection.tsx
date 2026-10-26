import { useEffect, useState } from "react";
import { Monitor, X } from "lucide-react";

import { formatEndLabel, publicText, type RemoteSessionView } from "../../../shared/remote-session";
import { cn } from "@/lib/cn";
import { GROUPED_CARD, GROUPED_ROW } from "@/lib/grouped-card";
import { t } from "@/lib/i18n";
import { clearRemoteSessionLocal, focusRemoteSessionLocal } from "@/lib/remote-session-focus";
import type { Bot } from "@/state/store";
import { remoteClosePhase } from "./remote-close";
import { closeRemoteSession, focusRemoteSession } from "./remote-session-client";
import { remoteControllable, RemoteTakeover, STOP_CONFIRM_MS } from "./RemoteScreenCard";
import { RemoteSessionActions } from "./RemoteSessionActions";
import { remoteOsLabel } from "./RemoteSessionFacts";
import { RemoteSessionThumb } from "./RemoteSessionThumb";
import { useRemoteSessions } from "./use-remote-sessions";

export { remoteClosePhase };

/** The row's title: the computer's name, the code only when the name is
 * unknown. The code never repeats in the subtitle (it is in the tooltip). */
export function remoteRowTitle(view: RemoteSessionView): string {
  return publicText(view.hostname) || view.code;
}

/** The row's subtitle: user, OS, when the session ends on its own. */
export function remoteRowSubtitle(view: RemoteSessionView): string {
  const time = formatEndLabel(view.endAt);
  return [publicText(view.user), remoteOsLabel(view), time ? t("remoteSession.endsAt", { time }) : ""].filter(Boolean).join(" \u00b7 ");
}

/** Close stays on its own button: it never takes control. */
export async function runRemoteSessionClose(input: {
  confirmId: string | null;
  viewId: string;
  close: () => Promise<string | null>;
  onAsk: () => void;
  onClosed: () => void;
  onError: (message: string) => void;
}): Promise<void> {
  if (remoteClosePhase(input.confirmId, input.viewId) === "ask") {
    input.onAsk();
    return;
  }
  const failed = await input.close();
  if (failed) input.onError(failed);
  else input.onClosed();
}

/** Take control from the panel row: focus the session (the shell follows
 * it) and open the same window as the chat's screen card, never the
 * Computer tab. */
export function takeRemoteControl(input: {
  botId: string;
  sessionId: string;
  focusLocal: (botId: string, sessionId: string) => void;
  focusRemote: (botId: string, sessionId: string) => void;
  openWindow: () => void;
}): void {
  input.focusLocal(input.botId, input.sessionId);
  void input.focusRemote(input.botId, input.sessionId);
  input.openWindow();
}

/** The sidebar list. Hidden entirely when no session is active. */
export function RemoteSessionsPanel({
  botId,
  rows,
  confirmId,
  error,
  onTakeControl,
  onClose,
}: {
  botId: string;
  rows: RemoteSessionView[];
  confirmId: string | null;
  error: string | null;
  onTakeControl: (view: RemoteSessionView) => void;
  onClose: (view: RemoteSessionView) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section data-remote-sessions="" data-remote-sessions-count={rows.length} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Monitor size={16} className="text-ink-secondary" />
        <h2 className="min-w-0 flex-1 text-[13px] font-normal leading-[18px] text-ink-secondary">{t("remoteSession.section")}</h2>
      </div>
      {rows.length > 0 && (
        <div className={GROUPED_CARD}>
          {rows.map((view) => {
            const title = remoteRowTitle(view);
            const confirming = confirmId === view.id;
            const takeControl = remoteControllable(view) && !view.headless ? () => onTakeControl(view) : undefined;
            return (
              <div key={view.id} data-remote-session-row="" className={cn("flex flex-col gap-2.5", GROUPED_ROW)}>
                <div className="flex items-start gap-2.5">
                  <RemoteSessionThumb botId={botId} view={view} {...(takeControl ? { onTakeControl: takeControl } : {})} />
                  <div className="min-w-0 flex-1" title={t("remoteSession.codeTitle", { code: view.code })}>
                    <span data-remote-row-title="" className="block truncate text-[13px] font-medium leading-[18px] text-ink">{title}</span>
                    <span data-remote-row-subtitle="" className="line-clamp-2 break-words text-[12.5px] leading-[18px] text-ink-secondary">{remoteRowSubtitle(view)}</span>
                  </div>
                  <button
                    type="button"
                    data-remote-close={confirming ? "confirm" : "ask"}
                    aria-label={confirming ? t("remoteSession.confirmClose") : t("remoteSession.close")}
                    title={confirming ? t("remoteSession.confirmClose") : t("remoteSession.close")}
                    onClick={(event) => { event.stopPropagation(); onClose(view); }}
                    className={confirming
                      ? "inline-flex h-[24px] shrink-0 items-center rounded-full bg-danger px-2.5 text-[12px] font-medium leading-4 text-[#fff] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/60 motion-reduce:transition-none"
                      : "ui-icon-button -mr-1 -mt-0.5 size-6 shrink-0 hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"}
                  >
                    {confirming ? t("remoteSession.confirmShort") : <X size={14} aria-hidden="true" />}
                  </button>
                </div>
                <RemoteSessionActions
                  botId={botId}
                  view={view}
                  compact
                  leading={takeControl && view.state === "connected" ? (
                    <button
                      type="button"
                      data-remote-take-control=""
                      onClick={takeControl}
                      className="ui-button h-[28px] gap-1.5 px-[11px] text-[12.5px] leading-[18px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    >
                      <Monitor size={15} aria-hidden="true" className="shrink-0" /> <span className="truncate">{t("remoteSession.takeControl")}</span>
                    </button>
                  ) : undefined}
                />
              </div>
            );
          })}
        </div>
      )}
      {error && <p className="text-[12px] text-danger" role="alert">{error}</p>}
    </section>
  );
}

/** Sidebar list of the bot's connected sessions, with an empty state. */
export function RemoteSessionsSection({ bot }: { bot: Bot }) {
  const { rows, reload } = useRemoteSessions(bot.id);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [controlling, setControlling] = useState<string | null>(null);
  // a first press on X is forgotten after a few seconds, like Stop on the screen card
  useEffect(() => {
    if (!confirmId) return;
    const timer = setTimeout(() => setConfirmId(null), STOP_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmId]);
  const controlled = rows.find((row) => row.id === controlling) ?? null;

  const takeControl = (view: RemoteSessionView) => {
    takeRemoteControl({
      botId: bot.id,
      sessionId: view.id,
      focusLocal: focusRemoteSessionLocal,
      focusRemote: focusRemoteSession,
      openWindow: () => setControlling(view.id),
    });
  };

  const close = (view: RemoteSessionView) => {
    void runRemoteSessionClose({
      confirmId,
      viewId: view.id,
      close: () => closeRemoteSession(bot.id, view.id),
      onAsk: () => setConfirmId(view.id),
      onClosed: () => {
        clearRemoteSessionLocal(bot.id, view.id);
        setConfirmId(null);
        reload();
      },
      onError: (message) => {
        setError(message);
      },
    });
  };

  return (
    <>
      <RemoteSessionsPanel
        botId={bot.id}
        rows={rows}
        confirmId={confirmId}
        error={error}
        onTakeControl={takeControl}
        onClose={close}
      />
      {controlled && <RemoteTakeover botId={bot.id} view={controlled} state="running" onClose={() => setControlling(null)} />}
    </>
  );
}
