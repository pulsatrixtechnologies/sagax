import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Clock3, Copy, LoaderCircle, Music, Play, RefreshCw, X } from "lucide-react";

import type { BareMediaKind } from "../../../shared/bare-image-urls.ts";
import { shareLinkExpiresAt, type WireVideoWidget } from "../../../shared/video-widget.ts";
import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { isExpiredAt } from "./video-player-state";
import { probeExpiry } from "./VideoPlayerParts";
import { VideoPlayerWidget } from "./VideoPlayerWidget";

type MessageScope = { threadId: string; messageId: string };

// A manifest or file name that says nothing about what plays.
const GENERIC_NAME = /^(?:index|playlist|master|manifest|main|prog_index|stream|video|audio|media)\.[a-z0-9]+$/i;

/** The title a player shows for a link: its file name when it says
 * something, else nothing (the player's "Untitled" wording). Never a link's
 * label: the text right above already shows it. */
export function mediaLinkTitle(url: string): string | undefined {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).at(-1);
    const name = last ? decodeURIComponent(last).trim() : "";
    return name && !GENERIC_NAME.test(name) ? name : undefined;
  } catch {
    return undefined;
  }
}

/** The source to play, from the server's verdict for this link of this
 * message (server/media/message-media-link.ts): an HLS stream comes back
 * through the media proxy, with the address itself as the fallback. Asked
 * only when the person presses Play. */
export async function resolveMediaLink(message: MessageScope, url: string): Promise<WireVideoWidget> {
  const answer = await api<{ video: WireVideoWidget }>(
    `/api/threads/${encodeURIComponent(message.threadId)}/messages/${encodeURIComponent(message.messageId)}/media`,
    { method: "POST", body: JSON.stringify({ url }) },
  );
  return answer.video;
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

type AudioState = "idle" | "loading" | "playing" | "expired" | "failed";

/** A clip from a link, drawn as a clip attachment is: a name and a Play
 * button, and nothing loads before that press. Then the server's source
 * plays in the native audio player; an expired or refused link, or one that
 * cannot be read, says so in words. */
function LinkAudioPlayer({ url, title, message, onRequestRefresh }: { url: string; title?: string; message: MessageScope; onRequestRefresh?: (message: string) => void }) {
  const [state, setState] = useState<AudioState>(() => (isExpiredAt(shareLinkExpiresAt(url)) ? "expired" : "idle"));
  const [src, setSrc] = useState<string | null>(null);
  const [refreshAsked, setRefreshAsked] = useState(false);
  const request = useRef<AbortController | null>(null);
  const name = title ?? t("media.untitledAudio");

  useEffect(() => {
    setState(isExpiredAt(shareLinkExpiresAt(url)) ? "expired" : "idle");
    setSrc(null);
    setRefreshAsked(false);
  }, [url]);
  useEffect(() => () => request.current?.abort(), []);

  const play = useCallback(async () => {
    if (request.current) return;
    if (isExpiredAt(shareLinkExpiresAt(url))) {
      setState("expired");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setState("loading");
    try {
      const video = await resolveMediaLink(message, url);
      if (controller.signal.aborted) return;
      if (isExpiredAt(video.expiresAt)) {
        setState("expired");
        return;
      }
      setSrc(video.playbackUrl);
      setState("playing");
    } catch {
      if (!controller.signal.aborted) setState("failed");
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [message, url]);

  const onError = useCallback(() => {
    const failed = src;
    setSrc(null);
    setState("loading");
    if (!failed) return setState("failed");
    void probeExpiry(failed).then((expired) => setState(expired ? "expired" : "failed"));
  }, [src]);

  const requestRefresh = useCallback(() => {
    if (!onRequestRefresh) return;
    onRequestRefresh(t("media.audioRefreshRequest", { title: name }));
    setRefreshAsked(true);
  }, [onRequestRefresh, name]);

  const broken = state === "expired" || state === "failed";
  return (
    <div className="flex w-full flex-col gap-2 rounded-2xl border border-hairline/30 bg-inset/60 px-3 py-2.5" data-media-audio={state}>
      <div className="flex min-w-0 items-center gap-2">
        {state === "playing" ? <Music size={14} className="shrink-0 text-accent" aria-hidden="true" />
          : state === "expired" ? <Clock3 size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
          : (
            <button
              type="button"
              disabled={state === "loading"}
              onClick={() => void play()}
              aria-label={t("attach.previewAudio", { name })}
              title={t("attach.previewAudio", { name })}
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent transition-colors hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-wait"
            >
              {state === "loading" ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={13} fill="currentColor" />}
            </button>
          )}
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink" title={name}>{name}</span>
      </div>
      {state === "playing" && src && (
        <audio src={src} controls autoPlay preload="metadata" aria-label={name} onError={onError} className="h-9 w-full" />
      )}
      {broken && (
        <div className="flex flex-col items-start gap-2" role="status">
          <p className="text-[12.5px] text-ink-secondary">
            {state === "expired" ? t("media.linkExpired") : t("media.audioUnavailable")}
          </p>
          <div className="flex flex-wrap gap-2">
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
              onClick={() => void play()}
              className="rounded-full border border-hairline/60 px-3 py-1 text-[12px] font-medium text-ink transition-colors hover:bg-raised"
            >
              {t("video.retry")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The player a chat link to a playable file gets (remark-bare-images marks
 * it): the chat's video card for a video or an HLS stream, a clip card for
 * audio. Nothing loads before the person presses Play; the source then comes
 * from the server's verdict for that link of that message, the one every
 * media card of the chat follows (the proxy for HLS). `link` is the chat's
 * own link to the address, shown under the player when the text above does
 * not already show it. Without a stored message (a reply still streaming)
 * there is no source to ask for: the address stays a link.
 */
export const ChatMediaLink = memo(function ChatMediaLink({
  url,
  kind,
  link,
  message,
  onRequestRefresh,
}: {
  url: string;
  kind: BareMediaKind;
  /** The address as the chat draws a link; absent when the text shows it. */
  link?: ReactNode;
  message?: MessageScope;
  /** Asks the bot for a fresh link once this one expired. */
  onRequestRefresh?: (message: string) => void;
}) {
  const title = mediaLinkTitle(url);
  const threadId = message?.threadId;
  const messageId = message?.messageId;
  const resolveSource = useCallback(
    () => (threadId && messageId ? resolveMediaLink({ threadId, messageId }, url) : Promise.resolve(null)),
    [threadId, messageId, url],
  );
  if (!threadId || !messageId) return link ? <p data-media-pending="">{link}</p> : null;
  let player: ReactNode;
  if (kind === "audio") {
    player = <LinkAudioPlayer url={url} title={title} message={{ threadId, messageId }} onRequestRefresh={onRequestRefresh} />;
  } else {
    const expiresAt = shareLinkExpiresAt(url);
    // the card as it shows before Play: its address is only the pop-out link
    const video: WireVideoWidget = {
      kind: "vod",
      playbackUrl: url,
      format: kind === "hls" ? "hls" : "mp4",
      ...(title ? { title } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    };
    player = <VideoPlayerWidget key={url} video={video} resolveSource={resolveSource} onRequestRefresh={onRequestRefresh} />;
  }
  return (
    <div className="my-2 flex w-[560px] max-w-full flex-col gap-1" data-chat-media={kind}>
      {player}
      {link && <MediaLinkCaption url={url} link={link} />}
    </div>
  );
});
