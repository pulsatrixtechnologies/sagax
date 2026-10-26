/** Privacy-enhanced YouTube embed and IFrame API loader. */

const API_SRC = "https://www.youtube.com/iframe_api";

let apiPromise: Promise<void> | undefined;

export function loadYoutubeIframeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const w = window as typeof window & { YT?: { Player: unknown }; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (document.querySelector(`script[src="${API_SRC}"]`)) return;
    const script = document.createElement("script");
    script.src = API_SRC;
    script.async = true;
    document.head.appendChild(script);
  });
  return apiPromise;
}

export type YoutubePlayerHandle = {
  seekTo: (seconds: number) => void;
  getCurrentTimeMs: () => number | null;
  play: () => void;
  pause: () => void;
  destroy: () => void;
};

type YtTarget = {
  seekTo: (s: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  playVideo: () => void;
  pauseVideo: () => void;
  destroy: () => void;
};

/** YouTube's onError codes: 2 bad id, 5 HTML5 player, 100 removed or
 * private, 101 and 150 the owner refuses embedding, 152 and 153 the player
 * could not identify the embedding page (no Referer). The card offers the
 * video on YouTube for any of them. */
export type YoutubeEmbedErrorCode = number;

export type YoutubePlayerHooks = {
  /** The player could not play here: the card offers the video on YouTube. */
  onError?: (code: YoutubeEmbedErrorCode) => void;
};

/** The IFrame API's options for one chat player. `origin` is the page's own
 * origin: the player posts its API messages (ready, state, current time)
 * there. The embed host stays youtube-nocookie. */
export function youtubePlayerOptions(videoId: string, origin: string) {
  return {
    // 100% both ways: left to itself the IFrame API writes width="640"
    // height="390" on the iframe. YouTube's own controls (play, scrub bar,
    // fullscreen) stay on: nothing of Sagax is laid over the player.
    width: "100%",
    height: "100%",
    videoId,
    host: "https://www.youtube-nocookie.com",
    playerVars: {
      controls: 1,
      fs: 1,
      rel: 0,
      playsinline: 1,
      origin,
    },
  };
}

/** The video's page on YouTube, for a player that cannot play it here. */
export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

export async function createYoutubePlayer(
  mount: HTMLElement,
  videoId: string,
  hooks: YoutubePlayerHooks = {},
): Promise<YoutubePlayerHandle | null> {
  await loadYoutubeIframeApi();
  const w = window as typeof window & {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: {
          width?: string | number;
          height?: string | number;
          videoId: string;
          host?: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (e: { target: YtTarget }) => void;
            onError?: (e: { data: number }) => void;
          };
        },
      ) => YtTarget;
    };
  };
  const Player = w.YT?.Player;
  if (!Player) return null;
  return new Promise((resolve) => {
    let ready = false;
    const player = new Player(mount, {
      ...youtubePlayerOptions(videoId, window.location.origin),
      events: {
        // An error before ready never readies: settle with no handle (the
        // caller sees null) and let go of the player.
        onError: (event) => {
          hooks.onError?.(Number(event?.data));
          if (!ready) {
            ready = true;
            try { player.destroy(); } catch { /* already gone */ }
            resolve(null);
          }
        },
        onReady: (event) => {
          if (ready) return;
          ready = true;
          const target = event.target;
          resolve({
            seekTo: (seconds) => target.seekTo(seconds, true),
            getCurrentTimeMs: () => {
              try {
                const s = target.getCurrentTime();
                return Number.isFinite(s) ? Math.round(s * 1000) : null;
              } catch {
                return null;
              }
            },
            play: () => target.playVideo(),
            pause: () => target.pauseVideo(),
            destroy: () => target.destroy(),
          });
        },
      },
    });
    void player;
  });
}
