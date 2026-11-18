/** Isolated gallery for headless screenshots of the two X cards (#4638). Not
 * shipped in the app. An invented account ("Sample Account", @sample) and
 * neutral text: nothing here names a real person, company or host.
 * ?lang=fr|en &skin=<id> &scene=<name>
 *   draft      the bot's line, then the draft card (default)
 *   near       the draft edited near the limit: the counter shows
 *   over       the draft over the limit: Post is off
 *   posted     the card after Post: the published post with its link
 *   sending    the card while the bot posts
 *   failed     the card when the post did not go out
 *   single     one post with a quoted post and a photo
 *   timeline   three posts stacked

 *   held       a bot's own X post call held for the answer: the same card
 *   neighbour  the email draft card (the conforming neighbour) beside the draft card
 * The gallery has no server: fetch answers the card's own calls. */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { EmailCard } from "../components/EmailCard";
import { XDraftCard } from "../components/XPostCards";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { nearLimitText, quotePost, sampleDraft, samplePost, timelinePosts, type Lang } from "../lib/x-post-fixtures";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang: Lang = params.get("lang") === "en" ? "en" : "fr";
await loadLocale(lang);
const scene = params.get("scene") ?? "draft";

const draft = sampleDraft(lang);
const textFor = (name: string) => (name === "near" ? nearLimitText(lang) : name === "over" ? nearLimitText(lang, true) : draft.text);
const shownText = textFor(scene);
const key = (await import("../../shared/x-post")).xDraftKey(shownText);

// the card's own calls: a state read, and Post or Discard
const serverState: Record<string, unknown> | null =
  scene === "posted" ? { status: "posted", text: shownText, url: "https://x.com/sample/status/1000000000000000009" }
    : scene === "sending" ? { status: "sending", text: shownText }
      : scene === "failed" ? { status: "failed", text: shownText, error: lang === "fr" ? "limite de débit atteinte" : "rate limit reached" }
        : null;
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/x-posts/")) {
    const method = init?.method ?? "GET";
    return new Response(JSON.stringify(method === "GET" ? { post: serverState } : { ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return nativeFetch(input, init);
};

const fence = (language: string, body: string) => `\`\`\`${language}\n${body}\n\`\`\``;
const botLine = lang === "fr" ? "Voici un brouillon. Il ne part pas avant que tu appuies sur Publier." : "Here's a draft. It won't go out until you press Post.";
const readLine = lang === "fr" ? "Voici ce que j'ai trouvé." : "Here is what I found.";
const draftFence = fence("x-post", JSON.stringify({ text: shownText, name: draft.name, handle: draft.handle }));
const singleFence = fence("x-posts", JSON.stringify({
  posts: [samplePost(lang, { quoted: quotePost(lang), media: [{ type: "photo", url: "https://pbs.twimg.com/media/sample.jpg", alt: "Sample" }] })],
}));
const timelineFence = fence("x-posts", JSON.stringify({ posts: timelinePosts(lang) }));

function Frame({ children }: { children: ReactNode }) {
  return <main className="min-h-screen bg-canvas p-4 text-ink sm:p-8"><div className="mx-auto max-w-[44rem]" data-gallery-chat>{children}</div></main>;
}
const bubble = (text: string) => <div className="mb-2 w-fit max-w-[min(42rem,90%)] rounded-2xl bg-card px-4 py-2.5 text-[15px] leading-relaxed text-ink">{text}</div>;
const chat = (text: string, id: string) => (
  <ChatMarkdown text={text} botId="bot-gallery" draftId="bot:bot-gallery:thread-gallery" message={{ threadId: "thread-gallery", messageId: id }} />
);

function Page() {
  if (scene === "held") {
    // a bot's own X post call, held for the answer: the same card, Post answers that call
    const note = lang === "fr" ? "Sample attend ta réponse" : "Sample is waiting for you";
    return <Frame><div className="mb-2 text-[13px] text-ink-secondary">{note}</div><XDraftCard draft={draft} held={{ onPost: () => {}, onDiscard: () => {} }} /></Frame>;
  }
  if (scene === "single") return <Frame>{bubble(readLine)}{chat(singleFence, "m-2")}</Frame>;
  if (scene === "timeline") return <Frame>{bubble(readLine)}{chat(timelineFence, "m-3")}</Frame>;
  if (scene === "neighbour") {
    return (
      <Frame>
        <EmailCard draft={{ to: ["sample@example.com"], cc: [], bcc: [], subject: lang === "fr" ? "Sujet de démonstration" : "Sample subject", body: lang === "fr" ? "Bonjour,\n\nUn message de démonstration." : "Hello,\n\nA sample message." }} threadId="thread-gallery" botId="bot-gallery" />
        {chat(draftFence, "m-1")}
      </Frame>
    );
  }
  return <Frame>{bubble(botLine)}{chat(draftFence, "m-1")}</Frame>;
}

void key;
createRoot(document.getElementById("root")!).render(<StrictMode><Page /></StrictMode>);
