/** Isolated gallery for headless screenshots of the reply to a highlighted
 * passage (#4487): a selection in a bot's message shows Cite; with a comment
 * the editor's button reads Send and the reply goes to the conversation.
 * Nothing is sent. Not shipped in the app. ?lang=<code>&skin=<id> */
import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CitationSelectionToolbar } from "../components/CitationUI";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const TEXT = params.get("lang") === "en"
  ? "The next bots will not receive this section. Share it again if a new bot needs it."
  : "Les prochains bots ne recevront pas cette section. Partage-la de nouveau si un nouveau bot en a besoin.";

function Gallery() {
  const viewport = useRef<HTMLDivElement>(null);
  const [sent, setSent] = useState("");
  return (
    <div ref={viewport} className="min-h-screen bg-canvas p-6 text-ink">
      <div data-shot="message" data-citation-source="m-1" data-citation-owner-type="bot" data-citation-owner="scout" data-citation-thread="t-1"
        className="mx-auto max-w-[720px] rounded-2xl bg-card px-5 py-4 text-[14px] leading-relaxed">
        <p id="passage">{TEXT}</p>
      </div>
      <p data-sent className="mx-auto mt-3 max-w-[720px] text-[12px] text-ink-secondary">{sent}</p>
      <CitationSelectionToolbar viewportRef={viewport} onAdd={() => setSent("draft")} onReply={(citation) => setSent(`reply:${citation.comment}`)} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
