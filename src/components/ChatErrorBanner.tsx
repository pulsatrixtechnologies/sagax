import { X } from "lucide-react";
import { t } from "@/lib/i18n";
import { useNetworkOnline } from "@/lib/drafts";
import { isDeployOutageQuiet } from "@/lib/deploy-reconnect";
import { plainErrorLine } from "@/lib/plain-error";
import type { AppState } from "@/state/store";

// 2026-10-22: no "Showing saved messages" banner over an archived
// conversation. The messages show as they are; being offline has its own
// line (ChatStaleBanner).

/** The chat and room notice line: a thread or bot reference that no longer
 * resolves. Quiet, not an error; the store clears it after a few seconds. */
export function ChatNotice({ notice }: { notice: AppState["notice"] }) {
  if (!notice) return null;
  return (
    <div className="w-full px-5">
      <div role="status" className="mb-2 rounded-lg border border-hairline/40 bg-panel px-3 py-2 text-[13px] text-ink-secondary">
        {notice.kind === "bot-gone"
          ? t("thread.botGone")
          : notice.botName ? t("thread.goneShowing", { name: notice.botName }) : t("thread.gone")}
      </div>
    </div>
  );
}

/** Calm line while the live stream is down for a short deploy restart.
 * Live events resume from the cursor; no error toast for a sub-30 s outage. */
export function ChatReconnectBanner(props: {
  connected: boolean;
  everConnected: boolean;
  disconnectedAt: number | null;
}) {
  if (props.connected || !props.everConnected) return null;
  if (!isDeployOutageQuiet(props.disconnectedAt)) return null;
  return (
    <div className="w-full px-5">
      <div role="status" data-chat-reconnecting className="mb-2 rounded-lg border border-hairline/40 bg-panel px-3 py-2 text-[13px] text-ink-secondary">
        {t("chat.reconnecting")}
      </div>
    </div>
  );
}

/** Shown while the network is down: what is on screen may be behind, and a
 * message sent now waits in the queue until the connection returns. */
export function ChatStaleBanner() {
  const online = useNetworkOnline();
  if (online) return null;
  return (
    <div className="w-full px-5">
      <div role="status" data-chat-stale className="mb-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] text-warning">
        {t("chat.stale")}
      </div>
    </div>
  );
}

/** The chat and room error line. Callers pass the store error; dismissing
 * clears it, and the store clears it on its own after a few seconds. A
 * machine's words (a bare HTTP status, "Failed to fetch", a JSON body) read
 * as one plain line, with the original under Details. */
export function ChatErrorBanner({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;
  const plain = plainErrorLine(message);
  return (
    <div className="w-full px-5">
      <div role="alert" className="mb-2 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
        <div className="min-w-0 flex-1 break-words">
          <p>{plain ?? message}</p>
          {plain && <details className="mt-1 text-[12px] text-ink-secondary"><summary className="cursor-pointer">{t("chat.error.details")}</summary><p dir="auto" className="mt-1 break-words">{message}</p></details>}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("chat.error.dismiss")}
          title={t("chat.error.dismiss")}
          className="shrink-0 rounded p-0.5 hover:bg-danger/10"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
