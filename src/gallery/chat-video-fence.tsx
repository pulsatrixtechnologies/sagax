/** Isolated gallery for headless screenshots of a video card the bot writes
 * in its reply (2026-11-06): the sagaxVideos envelope in a json fence, as bare
 * JSON, and invalid JSON (fallback note with the link).
 * ?skin=midnight|daylight&mode=after|before. Before draws the same reply as
 * the old build did: the envelope as a raw code block. Synthetic data only. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { loadLocale } from "../lib/i18n";
import { applySkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
const skin: SkinId = skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : "midnight";
applySkin(skin);
await loadLocale(params.get("lang") ?? "en");
const before = params.get("mode") === "before";

const ENVELOPE = `{"sagaxVideos":[{"kind":"live","url":"https://media.example.test/v1/share/live/channel/index.m3u8","title":"Evening stream","streamer":"channel"}]}`;
const fence = before ? "text" : "json";
const JSON_FENCE = `Player's on the card. She's still live.\n\n\`\`\`${fence}\n${ENVELOPE}\n\`\`\`\n\nHit play on that card.`;
const BARE = before ? `Here she is:\n\n\`\`\`text\n${ENVELOPE}\n\`\`\`` : `Here she is:\n\n${ENVELOPE}`;
const INVALID = `Link:\n\n\`\`\`${before ? "text" : "json"}\n{"sagaxVideos":[{"kind":"live","url":"https://media.example.test/v1/share/live/channel/index.m3u8"\n\`\`\``;

function Column({ title, text }: { title: string; text: string }) {
  return (
    <div className="w-[520px] p-4">
      <div className="mb-2 text-[12px] text-ink-secondary">{title}</div>
      <div className="rounded-2xl bg-card px-4 py-3 text-[14px] text-ink">
        <ChatMarkdown text={text} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="flex flex-wrap items-start gap-0 bg-app" data-gallery data-skin={skin}>
      <Column title={`${skin} · ${before ? "before" : "after"} · json fence`} text={JSON_FENCE} />
      <Column title={`${skin} · ${before ? "before" : "after"} · bare JSON`} text={BARE} />
      <Column title={`${skin} · ${before ? "before" : "after"} · invalid JSON`} text={INVALID} />
    </div>
  </StrictMode>,
);
