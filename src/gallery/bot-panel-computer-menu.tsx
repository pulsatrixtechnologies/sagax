/** Gallery for screenshots: the bot panel's Computer section above an Upcoming-style
 * header, so the bare "..." on both header rows compare side by side. Not shipped.
 * ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MoreHorizontal } from "lucide-react";
import { PANEL_LABEL } from "../lib/grouped-card";
import { ComputerCard } from "../components/bot-settings/ComputerCard";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const bot = { id: "bot-1", name: "Scout", title: "", description: "", messages: [], tasks: [], threadId: "t1", busy: false, computer: "cloud" } as never as Bot;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <aside data-gallery-panel="" className="min-h-screen w-[380px] border-r border-hairline/40 bg-panel text-ink">
        <div className="flex flex-col gap-6 px-4 pb-6 pt-4">
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h2 className={`${PANEL_LABEL} min-w-0 flex-1`}>{t("routines.upcoming.title")}</h2>
              <button type="button" data-upcoming-more="" className="ui-icon-button"><MoreHorizontal size={15} /></button>
            </div>
          </section>
          <ComputerCard bot={bot} onPatch={() => {}} />
        </div>
      </aside>
    </StoreProvider>
  </StrictMode>,
);
