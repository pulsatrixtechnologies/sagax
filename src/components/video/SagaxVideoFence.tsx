import { memo } from "react";

import type { SagaxVideoFence, WireVideoWidget } from "../../../shared/video-widget.ts";
import { t } from "@/lib/i18n";
import { VideoPlayerWidget } from "./VideoPlayerWidget";

/**
 * A video card a bot wrote in its reply ({"sagaxVideos":[...]} in a ```video,
 * ```json or unlabeled fence, or bare JSON). The server turns new replies into
 * proxied player rows; this draws the ones still in a message's text (older
 * messages, a reply while it streams in). A card that cannot be read keeps a
 * message and its link, never raw JSON and never an empty box.
 */
export const SagaxVideoFenceView = memo(function SagaxVideoFenceView({ fence }: { fence: SagaxVideoFence }) {
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
        const video: WireVideoWidget = {
          kind: emit.kind ?? "vod",
          playbackUrl: emit.url,
          ...(emit.format ? { format: emit.format } : {}),
          title: emit.title,
          streamer: emit.streamer,
          source: emit.source,
          posterUrl: emit.posterUrl,
          durationMs: emit.durationMs,
          viewerCount: emit.viewerCount,
        };
        return <VideoPlayerWidget key={`${emit.url}:${index}`} video={video} />;
      })}
    </div>
  );
});
