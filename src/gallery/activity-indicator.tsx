/** Isolated gallery for screenshots of the chat's activity line
 * (BotActivityIndicator): thinking (dots in the bot's colour, a rotating
 * phrase with a sheen) and typing (the bot's mascot, "Typing…"), under a
 * person's message as in a conversation. Not shipped in the app.
 * ?lang=en|fr&skin=<id>&view=both|thinking|typing&color=<swatch>&reduced=1 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BotActivityIndicator, type BotActivityMode } from "../components/BotActivityIndicator";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "en";
setLocale(lang);
document.documentElement.lang = lang;
if (params.get("reduced") === "1") document.documentElement.dataset.reducedMotion = "true";
const view = params.get("view") ?? "both";
const modes: BotActivityMode[] = view === "thinking" ? ["thinking"] : view === "typing" ? ["typing"] : ["thinking", "typing"];

const bot = { name: "Wren", color: params.get("color") ?? "orange" } as { name: string; color: "orange" };
const asked = lang.startsWith("fr") ? "Peux-tu résumer les notes de la réunion d'hier ?" : "Can you sum up yesterday's meeting notes?";

function Conversation({ mode }: { mode: BotActivityMode }) {
  return (
    <section data-gallery-mode={mode} className="flex w-[560px] flex-col gap-4 rounded-2xl bg-app px-6 py-6">
      <div className="flex justify-end">
        <p className="max-w-[80%] rounded-[18px] bg-bubble-user px-4 py-2 text-[14px] text-ink">{asked}</p>
      </div>
      <div className="flex items-center ps-1">
        <BotActivityIndicator bot={bot} mode={mode} seed="gallery" />
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="flex min-h-screen flex-col items-start gap-6 bg-panel p-8">
      {modes.map((mode) => <Conversation key={mode} mode={mode} />)}
    </main>
  </StrictMode>,
);
