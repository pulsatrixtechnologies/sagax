import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { openProviderKeyDialog } from "../settings/ProviderKeys";
import { voiceAccessCardText, type VoiceAccessCard } from "./voice-access-card";

/** Access card and note/notice lines inside the call pill's expanded card. */
export function VoiceModeBarAlerts({
  refusal,
  note,
  notice,
  noteRetry,
  onRetry,
  onOpenProviders,
}: {
  refusal: VoiceAccessCard | null;
  note: string | null;
  notice?: string | null;
  noteRetry: boolean;
  onRetry(): void;
  onOpenProviders(): void;
}) {
  return (
    <>
      {refusal && (
        <div role="alert" className="my-1 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] text-ink" data-voice-access-card>
          {voiceAccessCardText(refusal).map((line, index) => (
            <div key={index} className={index === 0 ? "font-medium" : "mt-0.5 text-ink-secondary"}>{line}</div>
          ))}
          {refusal.admin && refusal.cause === "no_credentials" && (
            <button
              type="button"
              data-voice-action="open-connections"
              onClick={() => {
                onOpenProviders();
                // Grok voice runs on the xAI key (2026-10-14): open its row.
                openProviderKeyDialog("xai");
              }}
              className="mr-1.5 mt-1.5 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-ink hover:brightness-110"
            >
              {t("voiceMode.openXaiKey")}
            </button>
          )}
          {refusal.keysUrl && refusal.cause === "no_credentials" && (
            <button
              type="button"
              onClick={() => {
                if (window.ogb?.openExternal) void window.ogb.openExternal(refusal.keysUrl!);
                else window.open(refusal.keysUrl, "_blank", "noopener");
              }}
              className="mt-1.5 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-ink hover:brightness-110"
            >
              {t("voiceMode.addOwnKey")}
            </button>
          )}
        </div>
      )}
      {(note || notice) && !refusal && (
        <div className={cn("my-1 flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-[12.5px]", note ? "bg-warning/10 text-warning" : "bg-raised/60 text-ink-secondary")} role={note ? "alert" : "status"}>
          <span>{note ?? notice}</span>
          {note && noteRetry && (
            <button type="button" onClick={onRetry} className="shrink-0 rounded-full border border-warning/40 px-2.5 py-0.5 text-[12px] hover:bg-warning/10">
              {t("voiceMode.retry")}
            </button>
          )}
        </div>
      )}
    </>
  );
}
