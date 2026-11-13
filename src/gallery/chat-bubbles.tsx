/** Isolated gallery for headless screenshots of the conversation bubbles
 * (2026-10-28): the person's own message filled with the accent, a bot's reply
 * and another person's message in a neutral grey, with what a bubble can hold
 * (a link, inline code, a mention, a quote, a page chip, a citation, the
 * "taken into account" note; a table, a code block and a card in a reply).
 * One column per accent, each its own skin context. Not shipped in the app.
 * ?skin=<id>&lang=<code>&mode=after|before (before draws the old classes) */
import { StrictMode, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { SentCitations } from "../components/CitationUI";
import { PageRefChip } from "../components/PageComposerParts";
import { ReplyQuote } from "../components/ReplyQuote";
import { MentionText } from "../components/MentionText";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { SkinTintId } from "../lib/skin-families";
import type { Message } from "../state/store";
import { brandBubbleVars } from "../lib/bubble-colors"; // before-strip
import { accentInk } from "../lib/brand";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
const skin: SkinId = skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin();
applySkin(skin);
await loadLocale(params.get("lang") ?? "en");
const before = params.get("mode") === "before";

const quoted: Message = { id: "q", role: "bot", kind: "text", text: "The Q3 report is ready.", at: 1 };
const citation = {
  kind: "citation" as const, version: 1 as const, id: "c1", quote: "The Q3 report is ready.", size: 24,
  source: { ownerType: "bot" as const, ownerId: "b", threadId: "t", messageId: "q", start: 0, end: 4, prefix: "", suffix: "" },
};
const answer = `Done: **3 tickets** updated. See [the report](https://example.com) and \`ticket.close\`.

| Ticket | Status |
| --- | --- |
| #1042 | Closed |
| #1043 | Waiting |

\`\`\`ts
const closed = tickets.filter((t) => t.done);
\`\`\``;

// the brand accent a deployment can set: orange
const ORANGE = "#f97316";

function Column({ label, tint, orange }: { label: string; tint?: SkinTintId; orange?: boolean }) {
  const style: CSSProperties | undefined = orange
    ? ({ "--color-accent": ORANGE, "--color-accent-text": ORANGE, "--color-accent-ink": accentInk(ORANGE), ...(before ? {} : brandBubbleVars(ORANGE)) } as CSSProperties)
    : undefined;
  const userCls = before
    ? "bg-bubble-user px-3 py-[7px] text-ink"
    : "bg-bubble-user px-3 py-[7px] text-ink";
  return (
    <div data-skin={skin} data-skin-tint={tint} style={style} className="flex w-[360px] flex-col gap-2 bg-app p-4 text-ink" data-gallery-column={label}>
      <div className="text-[11px] text-ink-secondary">{label}</div>
      <div><button type="button" className="rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-ink">Connect (accent button)</button></div>
      <div className="flex flex-col items-end gap-1">
        <div className={`chat-text w-fit max-w-[92%] rounded-[18px] text-[13px] leading-5 ${userCls}`} data-chat-bubble data-who="user">
          <div className="mb-2"><ReplyQuote message={quoted} fallbackName="Bot" compact /></div>
          <div><PageRefChip page={{ pageId: "p1", title: "Q3 report" }} botId="b" threadId="t" /></div>
          Close #1042 and tell <MentionText text="@Scout" peers={[{ name: "Scout", color: "blue" }]} /> about{" "}
          <button type="button" className="inline break-words text-start text-accent underline decoration-accent/40">#Q3 review</button>,{" "}
          see <a className="text-accent-text underline" href="https://example.com">the doc</a> and <code className="rounded bg-inset px-1 font-mono text-[12px]">ticket.close</code>.
          <SentCitations citations={[citation]} onNavigate={async () => true} />
          <div className="mt-1 text-[11px] text-ink-tertiary">{t("chat.sentMidTurn")}</div>
        </div>
      </div>
      <div className="flex flex-col items-start">
        <div
          className={before ? "w-full max-w-[calc(100%-20px)] text-[13px] leading-5 text-ink" : "w-fit max-w-[94%] rounded-[18px] bg-bubble-bot px-3 py-[7px] text-[13px] leading-5 text-ink"}
          data-chat-bubble data-who="bot"
        >
          <ChatMarkdown text={answer} />
          <div className="mt-2 rounded-xl border border-hairline/40 bg-card px-3 py-2 text-[12px]">Page card: Q3 report, v2</div>
        </div>
      </div>
      <div className="flex flex-col items-start">
        <div
          className={`chat-text w-fit max-w-[92%] rounded-[18px] px-3 py-[7px] text-[13px] leading-5 text-ink ${before ? "bg-raised ring-1 ring-inset ring-hairline/40" : "bg-bubble-bot"}`}
          data-chat-bubble data-who="person"
        >
          Marie: I will take the 1043 ticket.
        </div>
      </div>
    </div>
  );
}

const COLUMNS: Array<{ label: string; tint?: SkinTintId; orange?: boolean }> = [
  { label: "skin accent" },
  { label: "orange (brand)", orange: true },
  { label: "red", tint: "red" },
  { label: "green", tint: "green" },
  { label: "yellow", tint: "yellow" },
  { label: "ocean", tint: "ocean" },
];

// ?tints=duo: every duo-tone, whose bubble drifts toward the duo's far end (skin-duo.css)
const DUO_COLUMNS: Array<{ label: string; tint?: SkinTintId }> = (["aurore", "ocean", "neon", "foret", "cyberpunk", "sunset", "nordic", "candy"] as SkinTintId[]).map((tint) => ({ label: tint, tint }));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="flex flex-wrap items-start gap-0 bg-app" data-gallery>
      {(params.get("tints") === "duo" ? DUO_COLUMNS : COLUMNS).map((c) => <Column key={c.label} {...c} />)}
    </div>
  </StrictMode>,
);
