// The calm connection notice (#2013, src/lib/connection-notice.ts): a small
// pill at the top of the window, in the app's banner family (card surface,
// hairline and icon in the tone's color, one sentence, an ×), never over the
// composer. It goes by itself when the state clears; × hides it for this
// occurrence. Settings > Notifications > Connection notices turns it off.
import { CheckCircle2, CloudOff, Loader2, PlugZap, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useConnectionNotice, type ConnectionNoticeKind } from "@/lib/connection-notice";

type Kind = ConnectionNoticeKind | "reconnected";

const TONE: Record<Kind, string> = {
  updating: "border-accent/35 text-accent-text",
  server_unreachable: "border-warning/40 text-warning",
  perspicax_unreachable: "border-warning/40 text-warning",
  reconnected: "border-success/40 text-success",
};

export function connectionNoticeText(kind: Kind): string {
  switch (kind) {
    case "updating": return t("connectionNotice.updating");
    case "server_unreachable": return t("connectionNotice.serverUnreachable");
    case "perspicax_unreachable": return t("connectionNotice.perspicaxUnreachable");
    case "reconnected": return t("connectionNotice.reconnected");
  }
}

/** One notice, drawn from its kind (also the gallery's and the captures'). */
export function ConnectionNoticePill({ kind, onDismiss }: { kind: Kind; onDismiss: () => void }) {
  const Icon = kind === "updating" ? Loader2 : kind === "reconnected" ? CheckCircle2 : kind === "perspicax_unreachable" ? PlugZap : CloudOff;
  return (
    <div
      role="status"
      aria-live="polite"
      data-connection-notice={kind}
      className={cn(
        "connection-notice pointer-events-auto flex max-w-[min(440px,calc(100vw-32px))] items-center gap-2.5 rounded-full border bg-elevated py-1.5 pl-3 pr-1.5 text-[13px] shadow-lg shadow-black/10 backdrop-blur",
        TONE[kind],
      )}
    >
      <Icon size={15} aria-hidden className={cn("shrink-0", kind === "updating" && "animate-spin [animation-duration:1.6s]")} />
      <span className="min-w-0 flex-1 truncate text-ink">{connectionNoticeText(kind)}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("connectionNotice.dismiss")}
        title={t("connectionNotice.dismiss")}
        className="grid size-6 shrink-0 place-items-center rounded-full text-ink-secondary hover:bg-hover hover:text-ink"
      >
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}

/** Mounted once by the app shell. */
export function ConnectionNotice() {
  const notice = useConnectionNotice();
  if (!notice) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-[14px] z-[85] -translate-x-1/2" data-connection-notice-layer>
      <ConnectionNoticePill key={notice.kind} kind={notice.kind} onDismiss={notice.dismiss} />
    </div>
  );
}
