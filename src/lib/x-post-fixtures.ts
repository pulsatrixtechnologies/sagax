// Invented X data for the gallery, the tests and the captures (#4638). A made-up
// account and neutral text: nothing here names a real person, company or host.
import type { XDraft, XPostView } from "../../shared/x-post";

export type Lang = "fr" | "en";

export const SAMPLE_HANDLE = "sample";

export function sampleDraft(lang: Lang): XDraft {
  return {
    name: "Sample Account",
    handle: SAMPLE_HANDLE,
    text: lang === "fr"
      ? "Une version de démonstration est en ligne.\n\nElle montre comment un brouillon s'affiche avant la publication.\n\nDites-nous ce que vous en pensez."
      : "A sample build is live.\n\nIt shows how a draft looks before it is posted.\n\nTell us what you think.",
  };
}

/** A draft a few characters under the limit (counter shown), or over it. */
export function nearLimitText(lang: Lang, over = false): string {
  const seed = lang === "fr" ? "Un texte neutre pour mesurer le compteur. " : "A neutral text to measure the counter. ";
  let text = "";
  while (text.length < 270) text += seed;
  const cut = text.slice(0, 270);
  const head = cut.slice(0, cut.lastIndexOf(" ")).trim();
  return `${head} ${over ? "More words, past the limit, for the check." : "End."}`;
}

const NOW = Date.parse("2026-11-17T14:34:00-05:00");

export function samplePost(lang: Lang, over: Partial<XPostView> = {}): XPostView {
  return {
    id: "1000000000000000001",
    url: `https://x.com/${SAMPLE_HANDLE}/status/1000000000000000001`,
    name: "Sample Account",
    handle: SAMPLE_HANDLE,
    verified: true,
    createdAt: new Date(NOW - 26 * 3_600_000).toISOString(),
    text: lang === "fr"
      ? "Une publication de démonstration, avec un lien https://example.com/sample et le mot-clic #demo.\n\nDeuxième paragraphe, tout simple."
      : "A sample post, with a link https://example.com/sample and the hashtag #demo.\n\nA second paragraph, kept simple.",
    media: [],
    metrics: { replies: 12, reposts: 340, likes: 4_210, views: 128_500, bookmarks: 57 },
    ...over,
  };
}

export function quotePost(lang: Lang): XPostView {
  return samplePost(lang, {
    id: "1000000000000000002",
    url: `https://x.com/example_two/status/1000000000000000002`,
    name: "Example Two",
    handle: "example_two",
    verified: false,
    createdAt: new Date(NOW - 3 * 86_400_000).toISOString(),
    text: lang === "fr" ? "La publication citée : un court texte neutre." : "The quoted post: a short neutral text.",
    metrics: undefined,
  });
}

export function timelinePosts(lang: Lang): XPostView[] {
  return [
    samplePost(lang, { quoted: quotePost(lang) }),
    samplePost(lang, {
      id: "1000000000000000003", url: `https://x.com/${SAMPLE_HANDLE}/status/1000000000000000003`, verified: true,
      createdAt: new Date(NOW - 2 * 86_400_000).toISOString(),
      text: lang === "fr" ? "Une publication courte." : "A short post.",
      metrics: { replies: 3, reposts: 8, likes: 96, views: 2_300 },
    }),
    samplePost(lang, {
      id: "1000000000000000004", url: `https://x.com/${SAMPLE_HANDLE}/status/1000000000000000004`, verified: true,
      createdAt: "2026-02-03T12:00:00-05:00",
      text: lang === "fr" ? "Une publication plus ancienne, sans compteurs de réponses." : "An older post, with fewer counts.",
      metrics: { likes: 15, views: 640 },
    }),
  ];
}
