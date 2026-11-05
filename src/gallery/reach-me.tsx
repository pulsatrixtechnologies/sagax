/** Isolated gallery for headless screenshots of "Me joindre" (2026-10-26):
 * the bot panel's Overview with the Reach me group between the bot's email
 * address and the overview, in three states (default, text + Telegram
 * linking + hours, Telegram connected + Teams, and WhatsApp's three steps).
 * The capture script (scripts/capture/reach-me.mjs) answers /api itself.
 * Not shipped. ?skin=<id>&lang=<code>&state=default|setup|connected|
 * whatsapp-connect|whatsapp-linking|whatsapp-connected */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BotEmailAddress } from "../components/bot-settings/BotEmailAddress";
import { BotReachMe } from "../components/bot-settings/BotReachMe";
import { OverviewSection } from "../components/bot-settings/OverviewSection";
import type { BotOverview } from "../lib/bot-overview-types";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const overview: BotOverview = {
  who: { name: "Cryptic", title: "Comptabilité", blurb: "Classe les factures et prépare les paiements.", soulLead: "" },
  does: ["Résumé du matin, chaque jour à 8 h"],
  reaches: ["Microsoft 365 (courriel, calendrier)"],
  wont: ["N'envoie rien sans votre approbation"],
  recent: [],
};

function Gallery() {
  return (
    <div className="flex min-h-screen items-start gap-6 bg-canvas p-6 text-ink">
      <aside data-gallery-panel="overview" className="w-[400px] rounded-2xl border border-hairline/40 bg-panel px-4 pb-6 pt-4">
        <div className="flex flex-col gap-5">
          <BotEmailAddress botId="cryptic" />
          <BotReachMe botId="cryptic" />
          <OverviewSection overview={overview} prompt={null} onOpen={() => {}} />
        </div>
      </aside>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <Gallery />
    </StoreProvider>
  </StrictMode>,
);
