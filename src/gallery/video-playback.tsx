/** Real-playback gallery (2026-11-06): one video card fed by ?src= (a
 * /api/media/proxy/<token> path the local server minted, or any URL) and
 * ?format=hls|mp4, ?kind=live|vod, ?direct= (the original URL the card falls
 * back to). Headless checks read the <video> element
 * (currentTime, readyState) after pressing play. No synthetic poster: what
 * shows is what decoded. ?skin=midnight|daylight. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { WireVideoWidget } from "../../shared/video-widget.ts";
import { normalizeVideoFormat } from "../../shared/video-widget.ts";
import { VideoPlayerWidget } from "../components/video/VideoPlayerWidget";
import { loadLocale } from "../lib/i18n";
import { applySkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
const skin: SkinId = skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : "midnight";
applySkin(skin);
await loadLocale(params.get("lang") ?? "en");

const format = normalizeVideoFormat(params.get("format"));
const video: WireVideoWidget = {
  kind: params.get("kind") === "live" ? "live" : "vod",
  playbackUrl: params.get("src") ?? "",
  ...(params.get("direct") ? { directUrl: params.get("direct")! } : {}),
  ...(format ? { format } : {}),
  title: params.get("title") ?? "Playback check",
  streamer: params.get("streamer") ?? undefined,
  source: params.get("source") ?? undefined,
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="bg-app p-4" data-gallery data-skin={skin}>
      <div className="w-[560px] rounded-2xl bg-card px-4 py-3 text-[14px] text-ink">
        <VideoPlayerWidget video={video} />
      </div>
    </div>
  </StrictMode>,
);
