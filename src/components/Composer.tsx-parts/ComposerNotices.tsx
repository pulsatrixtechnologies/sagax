import { X } from "lucide-react";
import { t } from "@/lib/i18n";
import { cancelAttachmentUploads } from "@/lib/attachment-uploads";
import { forgetFailedComposerSend, type FailedComposerSend } from "@/lib/drafts";
import { ComposerNoticeBand } from "../WorkplaceNotice";

export function ComposerNotices({
  dictationError,
  voiceNoteError,
  failedSends,
  draftId,
  onRetryFailed,
}: {
  dictationError?: string | null;
  voiceNoteError?: string | null;
  failedSends: FailedComposerSend[];
  draftId: string;
  onRetryFailed: (failed: FailedComposerSend) => void;
}) {
  return (
    <>
      {(dictationError || voiceNoteError) && (
        <ComposerNoticeBand className="pointer-events-auto">
          <div className="w-full rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
            {dictationError || voiceNoteError}
          </div>
        </ComposerNoticeBand>
      )}
      {failedSends.map((failed) => (
        <ComposerNoticeBand key={failed.id}>
        <div
          className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger"
        >
          <span className="min-w-0 flex-1 truncate">
            {failed.offline
              ? t("composer.failed.offline", { text: failed.text.trim() || t("composer.failed.attachment") })
              : t("composer.failed.notSent", {
                  text: failed.text.trim() || t("composer.failed.attachment"),
                })}
          </span>
          <button
            type="button"
            onClick={() => onRetryFailed(failed)}
            className="shrink-0 rounded px-2 py-1 font-medium hover:bg-danger/10"
          >
            {t("chat.retry")}
          </button>
          <button
            type="button"
            onClick={() => {
              cancelAttachmentUploads(failed.attachmentIds ?? []);
              forgetFailedComposerSend(draftId, failed.id);
            }}
            aria-label={t("composer.failed.dismissAria")}
            title={t("composer.failed.dismiss")}
            className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-danger/10"
          >
            <X size={13} strokeWidth={2.5} />
          </button>
        </div>
        </ComposerNoticeBand>
      ))}
    </>
  );
}
