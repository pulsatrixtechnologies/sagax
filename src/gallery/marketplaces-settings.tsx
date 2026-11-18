/** Isolated gallery for the Settings "Marketplaces" add form and list. Not shipped in the app. ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MarketplacesSection } from "../components/plugins/MarketplacesSection";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const noop = () => {};
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="mx-auto max-w-[720px] bg-panel p-6 text-ink">
      <MarketplacesSection
        marketplaces={[
          { name: "claude-plugins-official", source: "anthropics/claude-plugins-official", plugins: [{ name: "a", installed: true }, { name: "b", installed: false }], visibility: "private", mine: true },
          { name: "team-tools", source: "pulsatrix/team-tools", ref: "main", plugins: [{ name: "c", installed: false }], visibility: "org", mine: true },
        ]}
        busy={null} error={null} onAdd={async () => true} onRefresh={noop} onRemove={noop} onSetVisibility={noop} canChooseVisibility
      />
    </main>
  </StrictMode>,
);
