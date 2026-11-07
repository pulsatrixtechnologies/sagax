import { memo } from "react";

import { shareLinkExpiresAt, type SagaxVideoFence, type WireVideoWidget } from "../../../shared/video-widget.ts";
import { t } from "@/lib/i18n";
import { VideoPlayerWidget } from "./VideoPlayerWidget";

/**
 * A video card a bot wrote in its reply ({"sagaxVideos":[...]} in a ```video,
 * ```json or unlabeled fence, or bare JSON). The server turns new replies into
 * proxied player rows; this draws the ones still in a message's text (older
 * messages, a reply while it streams in). A card that cannot be read keeps a
 * message and its link, never raw JSON and never an empty box.
 */
export const SagaxVideoFenceView = memo(function SagaxVideoFenceView({
  fence,
  onRequestRefresh,
}: {
  fence: SagaxVideoFence;
  /** Asks the bot for a fresh share link when one expired. */
  onRequestRefresh?: (message: string) => void;
}) {
  if (fence.status === "invalid") {
    return (
      <div role="note" data-video-fallback className="rounded-xl border border-hairline bg-panel px-3 py-2 text-[12.5px] text-ink-secondary">
        <p>{t("video.playbackError")}</p>
        {fence.url && (
          <a href={fence.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block break-all text-accent underline">
            {t("video.popOut")}
          </a>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-video-fence>
      {fence.videos.map((emit, index) => {
        const { url, poster: _poster, duration: _duration, ...details } = emit;
        const expiresAt = emit.expiresAt ?? shareLinkExpiresAt(url);
        const video: WireVideoWidget = {
          ...details,
          kind: emit.kind ?? "vod",
          playbackUrl: url,
          ...(expiresAt ? { expiresAt } : {}),
        };
        return <VideoPlayerWidget key={`${emit.url}:${index}`} video={video} onRequestRefresh={onRequestRefresh} />;
      })}
    </div>
  );
});
