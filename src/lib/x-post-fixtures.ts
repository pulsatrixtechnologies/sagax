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

/** The demo account's picture: the capture answers this X CDN address with a drawn avatar. */
export const SAMPLE_AVATAR = "https://pbs.twimg.com/profile_images/1000000000000000000/sample_400x400.jpg";

/** A post the demo account's bot just published (the Posted chip, the account's own picture). */
export function postedPost(lang: Lang, index = 0, over: Partial<XPostView> = {}): XPostView {
  const texts = lang === "fr"
    ? ["Une version de démonstration est en ligne. Dites-nous ce que vous en pensez #demo", "Petit rappel : la démo reste ouverte toute la semaine.", "Merci @example_two pour les retours, on s'en occupe.", "Nouveau guide de démonstration : https://example.com/guide", "Une dernière note de démonstration, courte et neutre.", "Fin de la série de démonstration."]
    : ["A sample build is live. Tell us what you think #demo", "A quick reminder: the demo stays open all week.", "Thanks @example_two for the feedback, we are on it.", "A new sample guide: https://example.com/guide", "One last sample note, short and neutral.", "End of the sample thread."];
  return {
    id: `100000000000000010${index}`,
    url: `https://x.com/${SAMPLE_HANDLE}/status/100000000000000010${index}`,
    name: "Sample Account",
    handle: SAMPLE_HANDLE,
    verified: true,
    avatarUrl: SAMPLE_AVATAR,
    createdAt: new Date(Date.now() - (2 + index) * 60_000).toISOString(),
    text: texts[index % texts.length]!,
    media: [],
    posted: true,
    ...over,
  };
}

/** A posted reply: "Replying to @handle" and the parent quoted. */
export function postedReply(lang: Lang): XPostView {
  return postedPost(lang, 2, {
    text: lang === "fr" ? "Merci pour le retour, c'est corrigé dans la prochaine version." : "Thanks for the feedback, it is fixed in the next version.",
    replyTo: { id: "1000000000000000002", handle: "example_two", post: { ...quotePost(lang), metrics: undefined } },
  });
}
