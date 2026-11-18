import { memo, useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, Clock3, Copy, LoaderCircle, Music, RefreshCw, X } from "lucide-react";

import type { BareMediaKind } from "../../../shared/bare-image-urls.ts";
import { shareLinkExpiresAt, type WireVideoWidget } from "../../../shared/video-widget.ts";
import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { probeExpiry } from "./VideoPlayerParts";
import { isExpiredAt } from "./video-player-state";
import { VideoPlayerWidget } from "./VideoPlayerWidget";

// A manifest or file name that says nothing about what plays.
const GENERIC_NAME = /^(?:index|playlist|master|manifest|main|prog_index|stream|video|audio|media)\.[a-z0-9]+$/i;

/** The title a player shows for a link: the link's own words, else the file
 * name, else nothing (the player's "Untitled" wording). */
export function mediaLinkTitle(url: string, label?: string): string | undefined {
  const words = label?.trim();
  if (words && words !== url) return words;
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).at(-1);
    const name = last ? decodeURIComponent(last).trim() : "";
    return name && !GENERIC_NAME.test(name) ? name : undefined;
  } catch {
    return undefined;
  }
}

/** The address under the player: the link the chat draws everywhere, and a
 * Copy button. */
function MediaLinkCaption({ url, link }: { url: string; link: ReactNode }) {
  const { state, copy } = useCopyFeedback(url);
  const label = t(state === "copied" ? "media.linkCopied" : "media.copyLink");
  return (
    <div className="flex min-w-0 items-center gap-1.5 px-0.5 text-[12px] text-ink-secondary" data-media-caption="">
      <span className="min-w-0 flex-1 truncate" title={url}>{link}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        title={label}
        className="shrink-0 rounded-md p-1 text-ink-secondary transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {state === "copied" ? <Check size={13} className="text-success" /> : state === "failed" ? <X size={13} className="text-danger" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

/** A clip from a link: the native audio player, straight from the address
 * (no token added, no Sagax cookie: another site's request), and its
 * expired or failed state in words. */
function LinkAudioPlayer({ url, title, onRequestRefresh }: { url: string; title?: string; onRequestRefresh?: (message: string) => void }) {
  const expiresAt = shareLinkExpiresAt(url);
  const [state, setState] = useState<"ready" | "checking" | "expired" | "failed">(() => (isExpiredAt(expiresAt) ? "expired" : "ready"));
  const [attempt, setAttempt] = useState(0);
  const [refreshAsked, setRefreshAsked] = useState(false);
  const name = title ?? t("media.untitledAudio");

  useEffect(() => {
    setState(isExpiredAt(shareLinkExpiresAt(url)) ? "expired" : "ready");
    setRefreshAsked(false);
  }, [url]);

  const onError = useCallback(() => {
    setState("checking");
    void probeExpiry(url).then((expired) => setState(expired ? "expired" : "failed"));
  }, [url]);

  const retry = useCallback(() => {
    setState(isExpiredAt(shareLinkExpiresAt(url)) ? "expired" : "ready");
    setAttempt((n) => n + 1);
  }, [url]);

  const requestRefresh = useCallback(() => {
    if (!onRequestRefresh) return;
    onRequestRefresh(t("media.audioRefreshRequest", { title: name }));
    setRefreshAsked(true);
  }, [onRequestRefresh, name]);

  return (
    <div className="flex w-full flex-col gap-2 rounded-2xl border border-hairline/30 bg-inset/60 px-3 py-2.5" data-media-audio={state}>
      <div className="flex min-w-0 items-center gap-2">
        {state === "checking"
          ? <LoaderCircle size={14} className="shrink-0 animate-spin text-ink-secondary" aria-hidden="true" />
          : state === "expired"
            ? <Clock3 size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
            : <Music size={14} className="shrink-0 text-accent" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink" title={name}>{name}</span>
      </div>
      {state === "ready" || state === "checking" ? (
        <audio
          key={attempt}
          src={url}
          controls
          preload="metadata"
          aria-label={name}
          onError={onError}
          className="h-9 w-full"
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2" role="status">
          <p className="min-w-0 flex-1 text-[12.5px] text-ink-secondary">
            {state === "expired" ? t("media.linkExpired") : t("media.audioUnavailable")}
          </p>
          {state === "expired" && onRequestRefresh && (
            <button
              type="button"
              onClick={requestRefresh}
              disabled={refreshAsked}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-[12px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <RefreshCw size={13} aria-hidden="true" />
              {refreshAsked ? t("video.refreshRequested") : t("video.requestNewLink")}
            </button>
          )}
          <button
            type="button"
            onClick={retry}
            className="rounded-full border border-hairline/60 px-3 py-1 text-[12px] font-medium text-ink transition-colors hover:bg-raised"
          >
            {t("video.retry")}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The player a chat link to a playable file gets (remark-bare-images marks
 * it): the chat's video player for a video or an HLS stream (native HLS where
 * the browser has it, hls.js otherwise), the native audio player for a clip.
 * `link` is the chat's own link to the address, shown under the player when
 * the text above does not already show it.
 */
export const ChatMediaLink = memo(function ChatMediaLink({
  url,
  kind,
  label,
  link,
  onRequestRefresh,
}: {
  url: string;
  kind: BareMediaKind;
  label?: string;
  /** The address as the chat draws a link; absent when the text shows it. */
  link?: ReactNode;
  /** Asks the bot for a fresh link once this one expired. */
  onRequestRefresh?: (message: string) => void;
}) {
  const title = mediaLinkTitle(url, label);
  let player: ReactNode;
  if (kind === "audio") {
    player = <LinkAudioPlayer url={url} title={title} onRequestRefresh={onRequestRefresh} />;
  } else {
    const expiresAt = shareLinkExpiresAt(url);
    const video: WireVideoWidget = {
      kind: "vod",
      playbackUrl: url,
      format: kind === "hls" ? "hls" : "mp4",
      ...(title ? { title } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    };
    player = <VideoPlayerWidget key={url} video={video} onRequestRefresh={onRequestRefresh} />;
  }
  return (
    <div className="my-2 flex w-[560px] max-w-full flex-col gap-1" data-chat-media={kind}>
      {player}
      {link && <MediaLinkCaption url={url} link={link} />}
    </div>
  );
});
