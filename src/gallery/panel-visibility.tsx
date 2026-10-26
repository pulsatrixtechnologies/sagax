/** Isolated gallery for screenshots of the bot panel's Suggestions card and
 * All history row, and of Settings > Appearance > Sidebar switches that
 * control them (not shipped). The capture script answers /api and sets the
 * two preferences in localStorage. ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ActivitySection } from "../components/bot-settings/ActivitySection";
import { SuggestionsSection } from "../components/bot-settings/SuggestionsSection";
import { AppearanceSettings } from "../components/settings/AppearanceSettings";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

const bot = {
  id: "gallery-bot", threadId: "t1", name: "Atlas", title: "Research", description: "", notifications: true, color: "blue", unread: false,
  modelSelection: { instanceId: "x", model: "x" }, messages: [], tasks: [],
} as unknown as Bot;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="flex min-h-screen items-start gap-6 bg-app p-4 text-ink">
        <aside data-gallery-panel="" className="w-[380px] border-r border-hairline/40 bg-panel">
          <div className="flex flex-col gap-6 px-4 pb-6 pt-4">
            <SuggestionsSection bot={bot} routineCount={0} />
            <ActivitySection bot={bot} />
          </div>
        </aside>
        <div data-gallery-appearance="" className="w-[640px]"><AppearanceSettings /></div>
      </div>
    </StoreProvider>
  </StrictMode>,
);
