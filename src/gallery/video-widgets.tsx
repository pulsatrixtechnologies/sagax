/** Isolated gallery for Playwright screenshots (not shipped in the app). */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { VideoPlayerWidget } from "../components/video/VideoPlayerWidget";
import { YouTubeMiniPlayer } from "../components/video/YouTubeMiniPlayer";
import { applySkin, readSkin } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin");
const skin = (skinParam === "daylight" || skinParam === "pulsatrix" ? skinParam : readSkin());
applySkin(skin);

// ?youtube=<id>: a real embed and a real transcript button (its /api call
// needs a server behind the gallery, e.g. a Vite proxy to a fixture server).
const live = params.get("youtube")?.match(/^[\w-]{11}$/)?.[0];

const poster = "https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800&q=80";
const avatar = "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=96&q=80";
const startedAt = new Date(Date.now() - 5_025_000).toISOString();
const liveVideo = {
  kind: "live" as const,
  playbackUrl: "/gallery-sample.mp4",
  title: "Championship finals, map 3",
  streamer: "NorthStar",
  source: "Video player",
  posterUrl: poster,
  avatarUrl: avatar,
  viewerCount: 12840,
  category: "Strategy",
  tags: ["English", "Finals"],
  startedAt,
  recording: true,
};
const vodVideo = {
  kind: "vod" as const,
  playbackUrl: "/gallery-sample.mp4",
  title: "Recording: season review",
  streamer: "NorthStar",
  source: "Video player",
  posterUrl: poster,
  avatarUrl: avatar,
  category: "Strategy",
  durationMs: 5_400_000,
  chapters: [
    { startMs: 0, title: "Intro" },
    { startMs: 900_000, title: "Draft" },
    { startMs: 2_700_000, title: "Map 1" },
    { startMs: 4_200_000, title: "Recap" },
  ],
};
// ?expanded=1: only the expanded view (its own screenshot).
const expandedOnly = params.get("expanded") === "1";

function Gallery() {
  if (expandedOnly) {
    return (
      <div className="min-h-screen bg-app p-8 text-ink">
        <VideoPlayerWidget showcase showcaseState={{ expanded: true }} video={liveVideo} />
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-app p-8 text-ink">
      <div className="mx-auto flex max-w-3xl flex-col gap-10">
        <section>
          <h1 className="mb-4 text-lg font-semibold">Live stream</h1>
          <VideoPlayerWidget showcase video={liveVideo} />
        </section>
        <section>
          <h1 className="mb-4 text-lg font-semibold">Live, behind the edge (DVR)</h1>
          <VideoPlayerWidget showcase showcaseState={{ behindLive: true }} video={liveVideo} />
        </section>
        <section>
          <h1 className="mb-4 text-lg font-semibold">Recording with chapters, options open</h1>
          <VideoPlayerWidget showcase showcaseState={{ menuOpen: true, current: 3100 }} video={vodVideo} />
        </section>
        <section>
          <h1 className="mb-4 text-lg font-semibold">Expired share link</h1>
          <VideoPlayerWidget
            showcase
            showcaseState={{ expired: true }}
            video={{ ...vodVideo, expiresAt: Date.now() - 60_000 }}
            onRequestRefresh={() => {}}
          />
        </section>
        <section>
          <h1 className="mb-4 text-lg font-semibold">YouTube</h1>
          <YouTubeMiniPlayer
            videoId="dQw4w9WgXcQ"
            posterOnly
            initialTitle="Never Gonna Give You Up"
            initialChannel="Rick Astley"
            startDrawerOpen
            highlightStartMs={18000}
            initialCues={[
              { startMs: 0, text: "We're no strangers to love" },
              { startMs: 18000, text: "You know the rules and so do I" },
              { startMs: 27000, text: "A full commitment's what I'm thinking of" },
              { startMs: 35000, text: "You wouldn't get this from any other guy" },
            ]}
          />
        </section>
        {live && (
          <section>
            <h1 className="mb-4 text-lg font-semibold">YouTube (live embed)</h1>
            <YouTubeMiniPlayer videoId={live} />
          </section>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
