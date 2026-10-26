import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import { ExternalLink, FileText } from "lucide-react";

import { api, ApiError } from "@/state/store";
import { t } from "@/lib/i18n";
import { createYoutubePlayer, youtubeWatchUrl, type YoutubePlayerHandle } from "@/lib/youtube-embed";
import type { MessageAttachmentContext } from "../AttachmentPreview";
import { MediaPlayerChrome } from "./MediaPlayerChrome";
import { TranscriptDrawer, type TranscriptCue } from "./TranscriptDrawer";

export const YouTubeMiniPlayer = memo(function YouTubeMiniPlayer({
  videoId,
  onSendToBot,
  initialTitle,
  initialChannel,
  initialCues,
  startDrawerOpen,
  highlightStartMs,
  posterOnly,
}: {
  videoId: string;
  message?: MessageAttachmentContext;
  onSendToBot?: (text: string) => void;
  /** Known title/channel (oEmbed fills these when omitted). */
  initialTitle?: string;
  initialChannel?: string;
  initialCues?: TranscriptCue[];
  startDrawerOpen?: boolean;
  highlightStartMs?: number;
  /** Gallery: poster and chrome only, no iframe. */
  posterOnly?: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YoutubePlayerHandle | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(!!startDrawerOpen);
  const [metaTitle, setMetaTitle] = useState(initialTitle ?? "");
  const [channel, setChannel] = useState(initialChannel ?? "");
  const [loading, setLoading] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cues, setCues] = useState<TranscriptCue[]>(initialCues ?? []);
  const [filter, setFilter] = useState("");
  const [activeCueMs, setActiveCueMs] = useState<number | null>(null);
  const [embedGrace, setEmbedGrace] = useState(false);
  // The player refused this video here (YouTube's onError code): the stage
  // offers it on YouTube instead of YouTube's own error screen.
  const [embedError, setEmbedError] = useState<number | null>(null);
  const titleId = useId();

  useEffect(() => {
    const id = window.setTimeout(() => setEmbedGrace(true), 3500);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    let cancel = false;
    const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    void fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`)
      .then((res) => (res.ok ? res.json() as Promise<{ title?: string; author_name?: string }> : null))
      .then((data) => {
        if (cancel || !data) return;
        if (data.title) setMetaTitle(data.title);
        if (data.author_name) setChannel(data.author_name);
      })
      .catch(() => undefined);
    return () => { cancel = true; };
  }, [videoId]);

  useEffect(() => {
    if (posterOnly) {
      setPlayerReady(true);
      return;
    }
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;
    let failed = false;
    setPlayerReady(false);
    setEmbedError(null);
    // A fresh element per player: the IFrame API replaces the element it is
    // given with its iframe, and a player that was mounted then torn down
    // (React's StrictMode, a remount) must not take the next one's element.
    const host = document.createElement("div");
    mount.replaceChildren(host);
    void createYoutubePlayer(host, videoId, {
      onError: (code) => {
        if (cancelled) return;
        failed = true;
        setEmbedError(code);
      },
    }).then((handle) => {
      if (cancelled || failed) {
        handle?.destroy();
        return;
      }
      playerRef.current = handle;
      setPlayerReady(!!handle);
    });
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
      mount.replaceChildren();
    };
  }, [videoId, posterOnly]);

  useEffect(() => {
    if (embedError == null) return;
    playerRef.current?.destroy();
    playerRef.current = null;
    mountRef.current?.replaceChildren();
  }, [embedError]);

  useEffect(() => {
    if (!drawerOpen || !cues.length) return;
    const tick = () => {
      const ms = playerRef.current?.getCurrentTimeMs?.();
      if (ms == null) return;
      const idx = cues.findIndex((c, i) => {
        const next = cues[i + 1]?.startMs ?? Infinity;
        return ms >= c.startMs && ms < next;
      });
      if (idx >= 0) setActiveCueMs(cues[idx].startMs);
    };
    const id = window.setInterval(tick, 400);
    return () => window.clearInterval(id);
  }, [drawerOpen, cues]);

  const fetchTranscript = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ cues: TranscriptCue[] }>("/api/youtube/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      setCues(res.cues);
      setDrawerOpen(true);
    } catch (e) {
      setError(transcriptErrorMessage(e));
      setDrawerOpen(true);
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  const handToBot = useCallback(() => {
    if (!onSendToBot || !cues.length) return;
    const body = cues.map((c) => `[${formatCue(c.startMs)}] ${c.text}`).join("\n");
    onSendToBot(t("youtube.handoffPrompt", { videoId, transcript: body }));
  }, [cues, onSendToBot, videoId]);

  const footerActions = (
    <button
      type="button"
      onClick={() => (cues.length ? setDrawerOpen((v) => !v) : void fetchTranscript())}
      disabled={loading}
      className="vpc-chip"
    >
      <FileText size={14} />
      {loading ? t("youtube.transcriptLoading") : cues.length ? t("youtube.transcriptPanel") : t("youtube.fetchTranscript")}
    </button>
  );

  return (
    <MediaPlayerChrome
      header={{
        title: metaTitle || t("youtube.playerTitle"),
        streamer: channel || undefined,
        source: "YouTube",
      }}
      stageRef={shellRef}
      labelId={titleId}
      loading={!playerReady && !embedGrace && embedError == null}
      embedControls
      footerActions={footerActions}
      drawerOpen={drawerOpen}
      drawer={
        drawerOpen ? (
          <TranscriptDrawer
            cues={cues}
            filter={filter}
            onFilter={setFilter}
            activeStartMs={highlightStartMs ?? activeCueMs}
            onSeek={(ms) => playerRef.current?.seekTo(ms / 1000)}
            error={error}
            onSendToBot={cues.length && onSendToBot ? handToBot : undefined}
          />
        ) : null
      }
    >
      <img
        src={`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`}
        alt=""
        onError={(e) => {
          e.currentTarget.src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        }}
      />
      {!posterOnly && (
        <div ref={mountRef} title={metaTitle || t("youtube.playerTitle")} hidden={embedError != null} />
      )}
      {embedError != null && (
        <div className="vpc-embed-fallback" data-youtube-error={embedError}>
          <a href={youtubeWatchUrl(videoId)} target="_blank" rel="noreferrer" className="vpc-chip">
            <ExternalLink size={14} />
            {t("youtube.watchOnYoutube")}
          </a>
        </div>
      )}
    </MediaPlayerChrome>
  );
});

/** The server answers with a code; the words are the app's, in the person's language. */
export function transcriptErrorMessage(e: unknown): string {
  const code = e instanceof ApiError ? e.body?.error : undefined;
  if (code === "no_captions") return t("youtube.noCaptions");
  if (code === "unavailable") return t("youtube.videoUnavailable");
  if (code === "blocked") return t("youtube.transcriptBlocked");
  return t("youtube.transcriptError");
}

function formatCue(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
