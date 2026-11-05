/** Isolated gallery for chat-width screenshots (#2004): Reading vs Full on a
 * wide viewport, with a table so the bubble caps show. ?width=reading|wide|full
 * &skin=<id>&lang=<code>. Not shipped in the app. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { chatBubbleWidthClasses, chatColumnClass } from "../lib/chat-bubble-width";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { parseChatWidth } from "../lib/chat-width-preference";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "en";
await loadLocale(lang);
document.documentElement.lang = lang;
const width = parseChatWidth(params.get("width"));
const fr = lang.startsWith("fr");
const bubbles = chatBubbleWidthClasses(width);
const column = chatColumnClass(width);

const asked = fr ? "Montre le plan en tableau." : "Show the plan as a table.";
const answer = fr
  ? "Voici le plan.\n\n| Étape | Durée | Risque |\n|---|---|---|\n| Copie des données | 2 h | Faible |\n| Bascule | 30 min | Moyen |\n| Vérification | 1 h | Faible |\n\n```bash\nrsync -a /srv/ancien/ /srv/nouveau/\n```"
  : "Here is the plan.\n\n| Step | Time | Risk |\n|---|---|---|\n| Copy the data | 2 h | Low |\n| Switch over | 30 min | Medium |\n| Check | 1 h | Low |\n\n```bash\nrsync -a /srv/old/ /srv/new/\n```";

function Bubble({ role, children, wide }: { role: "user" | "bot"; children: string; wide?: boolean }) {
  return (
    <div className={role === "user" ? "flex justify-end" : "flex justify-start"}>
      <div
        data-chat-bubble={role}
        className={[
          "rounded-[18px] px-3 py-[7px] text-[13px] leading-5 text-ink whitespace-pre-wrap",
          role === "user" ? "bg-bubble-user" : "bg-bubble-bot",
          role === "user" ? bubbles.fit : wide ? bubbles.wide : bubbles.fit,
        ].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main data-shot="chat-width" data-chat-width={width} className="min-h-screen bg-panel p-6">
      <div className="mx-auto w-full max-w-[1600px] rounded-2xl border border-hairline/40 bg-app px-5 py-8">
        <p className="mb-4 text-[12px] text-ink-secondary">chat width: {width}</p>
        <div className={column}>
          <Bubble role="user">{asked}</Bubble>
          <Bubble role="bot" wide>{answer}</Bubble>
        </div>
        <div className="mt-8 border-t border-hairline/40 pt-4">
          <div className={column}>
            <div className="rounded-[26px] border border-hairline-weak bg-composer px-4 py-3 text-[13px] text-ink-secondary">
              {fr ? "Message à Wren" : "Message to Wren"}
            </div>
          </div>
        </div>
      </div>
    </main>
  </StrictMode>,
);
