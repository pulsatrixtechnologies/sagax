/** Isolated gallery for headless screenshots of the two bot bubble toggles
 * (Settings > Appearance > Conversation): a 1:1 and a room, drawn with the
 * real class a bot's reply asks for (src/lib/bot-reply-bubbles.ts). Not
 * shipped in the app.
 * ?skin=<id>&lang=<code>&bubbles=on|off&accent=1|0 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { botBubbleAccent, botReplyBubbles, useBotReplyBubbleClass } from "../lib/bot-reply-bubbles";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "en";
await loadLocale(lang);
botReplyBubbles.set(params.get("bubbles") === "off" ? "off" : "on");
botBubbleAccent.set(params.get("accent") === "1" ? "1" : "0");

const fr = lang === "fr";
const first = fr ? "J'ai fermé **3 billets** et mis à jour le rapport." : "I closed **3 tickets** and updated the report.";
const second = fr ? "Voir [le rapport](https://example.com) et le suivi acme/app#1042." : "See [the report](https://example.com) and the follow-up acme/app#1042.";

function Bot({ text, room }: { text: string; room?: boolean }) {
  const cls = useBotReplyBubbleClass();
  return (
    <div className="flex flex-col items-start">
      <div className={`w-fit max-w-[94%] rounded-[18px] text-[13px] leading-5 text-ink ${cls}`} data-chat-bubble data-who={room ? "room-bot" : "bot"}>
        <ChatMarkdown text={text} />
      </div>
    </div>
  );
}

function Scene() {
  return (
    <div className="flex min-h-screen items-start justify-center bg-app p-8 text-ink">
      <div className="flex w-[760px] flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="text-[11px] text-ink-secondary">{fr ? "Conversation avec le bot" : "Conversation with the bot"}</div>
          <div className="flex flex-col items-end">
            <div className="chat-text w-fit max-w-[80%] rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px] leading-5 text-ink" data-chat-bubble data-who="user">
              {fr ? "Ferme les billets réglés." : "Close the settled tickets."}
            </div>
          </div>
          <Bot text={first} />
          <Bot text={second} />
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-[11px] text-ink-secondary">{fr ? "Salon : un bot et une autre personne" : "Room: a bot and another person"}</div>
          <Bot text={first} room />
          <div className="flex flex-col items-start">
            <div className="chat-text w-fit max-w-[80%] whitespace-pre-wrap rounded-[18px] bg-bubble-bot px-3 py-[7px] text-[13px] leading-5 text-ink" data-chat-bubble data-who="person">
              {fr ? "Merci, je regarde ça." : "Thanks, I will look."}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Scene /></StrictMode>);
