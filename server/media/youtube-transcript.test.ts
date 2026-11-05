import { describe, expect, it } from "vitest";
import { fetchYoutubeTranscript, orderTracks } from "./youtube-transcript.ts";

describe("fetchYoutubeTranscript", () => {
  it("parses caption tracks from a watch page", async () => {
    const html = `
      "captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc&lang=fr","languageCode":"fr"}]
    `;
    const fetchImpl = async (url: string) => {
      if (url.includes("watch?v=")) {
        return { ok: true, text: async () => html };
      }
      if (url.includes("timedtext")) {
        return {
          ok: true,
          text: async () => '<text start="1.5">Bonjour</text><text start="3">le monde</text>',
        };
      }
      throw new Error(`unexpected ${url}`);
    };
    const { cues } = await fetchYoutubeTranscript("abc12345678", fetchImpl as typeof fetch);
    expect(cues).toEqual([
      { startMs: 1500, text: "Bonjour" },
      { startMs: 3000, text: "le monde" },
    ]);
  });

  const captionsOf = async (xml: string) => {
    const html = `"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc","languageCode":"fr"}]`;
    const fetchImpl = async (url: string) => ({ ok: true, text: async () => (url.includes("watch?v=") ? html : xml) });
    return (await fetchYoutubeTranscript("abc12345678", fetchImpl as unknown as typeof fetch)).cues;
  };

  it("decodes YouTube's double-escaped caption text", async () => {
    expect(await captionsOf('<text start="0">l&amp;#39;homme &amp;quot;x&amp;quot; &quot;y&quot; &#39;z&#39;</text>')).toEqual([
      { startMs: 0, text: `l'homme "x" "y" 'z'` },
    ]);
  });

  it("decodes the two layers only, never a third", async () => {
    expect(await captionsOf('<text start="0">a &amp;amp;lt; b</text>')).toEqual([{ startMs: 0, text: "a &lt; b" }]);
  });

  it("decodes numeric entities and keeps a cue on one line", async () => {
    expect(await captionsOf('<text start="0">un&#10;deux &#x E9; &#xE9;t&#233; &#0; &#x110000;</text>')).toEqual([
      { startMs: 0, text: "un deux &#x E9; été &#0; &#x110000;" },
    ]);
  });

  it("strips markup inside a cue until none is left", async () => {
    const html = `"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc","languageCode":"fr"}]`;
    const fetchImpl = async (url: string) => ({
      ok: true,
      text: async () => (url.includes("watch?v=") ? html : '<text start="2"><font color="#fff">Bon<i>jour</i></font> &amp; <b>salut</b></text>'),
    });
    const { cues } = await fetchYoutubeTranscript("abc12345678", fetchImpl as unknown as typeof fetch);
    expect(cues).toEqual([{ startMs: 2000, text: "Bonjour & salut" }]);
  });

  // CodeQL js/incomplete-multi-character-sanitization (alerte #112) : le retrait
  // des balises boucle jusqu'a stabilite, donc une balise reconstruite par un
  // premier passage (<scr<script>ipt>) ne survit pas.
  it("retire une balise reconstruite par le retrait, sans en laisser", async () => {
    const [cue] = await captionsOf('<text start="0">avant <scr<script>ipt>alert(1)</script>ipt> apres</text>');
    expect(cue?.text).not.toMatch(/<\s*\/?\s*script/i);
    expect(cue?.text).not.toMatch(/<[a-z!/]/i);
    expect(cue?.text).toContain("avant");
    expect(cue?.text).toContain("apres");
  });

  it("refuses when no caption tracks exist", async () => {
    const fetchImpl = async () => ({ ok: true, text: async () => "<html></html>" });
    await expect(fetchYoutubeTranscript("abc12345678", fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ code: "no_captions" });
  });

  const playerAnswer = (tracks: Array<Record<string, string>>, status = "OK") => ({
    ok: true,
    json: async () => ({ playabilityStatus: { status }, captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } }),
  });
  const TT = "https://www.youtube.com/api/timedtext?v=abc12345678";

  it("reads the InnerTube player's tracks (format 3) without the watch page", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (url.includes("/youtubei/v1/player")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({ videoId: "abc12345678", context: { client: { clientName: "ANDROID" } } });
        return playerAnswer([
          { baseUrl: `${TT}&lang=en&kind=asr`, languageCode: "en", kind: "asr" },
          { baseUrl: `${TT}&lang=en&fmt=srv3`, languageCode: "en" },
        ]);
      }
      if (url.includes("timedtext")) {
        expect(url).not.toContain("fmt=");
        expect(url).not.toContain("kind=asr");
        return { ok: true, text: async () => '<timedtext format="3"><body><p t="1360" d="1680">We&#39;re no</p><p t="18640" d="3240"><s>strangers</s><s t="200"> to love</s></p></body></timedtext>' };
      }
      throw new Error(`unexpected ${url}`);
    };
    const result = await fetchYoutubeTranscript("abc12345678", fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({
      cues: [{ startMs: 1360, text: "We're no" }, { startMs: 18640, text: "strangers to love" }],
      language: "en",
      automatic: false,
    });
    expect(urls.some((u) => u.includes("watch?v="))).toBe(false);
  });

  it("prefers French, then written over automatic", () => {
    const order = orderTracks([
      { baseUrl: `${TT}&1`, languageCode: "de" },
      { baseUrl: `${TT}&2`, languageCode: "en", kind: "asr" },
      { baseUrl: `${TT}&3`, languageCode: "fr-CA", kind: "asr" },
      { baseUrl: `${TT}&4`, languageCode: "en" },
      { baseUrl: `${TT}&5`, languageCode: "fr" },
      { baseUrl: "https://evil.example/timedtext", languageCode: "fr" },
    ]);
    expect(order.map((t) => t.baseUrl!.slice(-1))).toEqual(["5", "3", "4", "2", "1"]);
  });

  it("tries the next track when one comes back empty (proof of origin wall)", async () => {
    const fetchImpl = async (url: string) => {
      if (url.includes("/youtubei/v1/player")) return playerAnswer([{ baseUrl: `${TT}&lang=fr`, languageCode: "fr" }, { baseUrl: `${TT}&lang=en`, languageCode: "en" }]);
      if (url.includes("lang=fr")) return { ok: true, text: async () => "" };
      return { ok: true, text: async () => '<p t="5">hello</p>' };
    };
    expect(await fetchYoutubeTranscript("abc12345678", fetchImpl as unknown as typeof fetch)).toMatchObject({ language: "en", cues: [{ startMs: 5, text: "hello" }] });
  });

  it("says blocked, not no_captions, when tracks exist but none returns text", async () => {
    const fetchImpl = async (url: string) => {
      if (url.includes("/youtubei/v1/player")) return playerAnswer([{ baseUrl: `${TT}&lang=fr`, languageCode: "fr" }]);
      return { ok: true, text: async () => "" };
    };
    await expect(fetchYoutubeTranscript("abc12345678", fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ code: "blocked" });
  });

  it("says no_captions when both sources list no track", async () => {
    const fetchImpl = async (url: string) => (url.includes("/youtubei/") ? playerAnswer([]) : { ok: true, text: async () => "<html></html>" });
    await expect(fetchYoutubeTranscript("abc12345678", fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ code: "no_captions" });
  });

  it("says unavailable for a private or removed video", async () => {
    const fetchImpl = async (url: string) => (url.includes("/youtubei/") ? playerAnswer([], "ERROR") : { ok: false, text: async () => "" });
    await expect(fetchYoutubeTranscript("abc12345678", fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("says blocked when YouTube cannot be reached at all", async () => {
    const fetchImpl = async () => {
      throw new Error("offline");
    };
    await expect(fetchYoutubeTranscript("abc12345678", fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ code: "blocked" });
  });

  it("rejects an invalid id before any fetch", async () => {
    await expect(fetchYoutubeTranscript("../etc", (async () => { throw new Error("no"); }) as unknown as typeof fetch)).rejects.toMatchObject({ code: "invalid_video" });
  });

  it("says blocked, not unavailable, for the bot check (LOGIN_REQUIRED on a datacenter address)", async () => {
    const fetchImpl = async (url: string) => (url.includes("/youtubei/") ? playerAnswer([], "LOGIN_REQUIRED") : { ok: false, text: async () => "" });
    await expect(fetchYoutubeTranscript("abc12345678", fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ code: "blocked" });
  });

  it("tries at most three tracks and never follows a redirect", async () => {
    const reads: RequestInit[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (url.includes("/youtubei/")) return playerAnswer(["de", "es", "it", "pt", "nl"].map((l) => ({ baseUrl: `${TT}&lang=${l}`, languageCode: l })));
      reads.push(init!);
      return { ok: true, text: async () => "" };
    };
    await expect(fetchYoutubeTranscript("abc12345678", fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ code: "blocked" });
    expect(reads).toHaveLength(3);
    expect(reads.every((r) => r.redirect === "error")).toBe(true);
  });
});
