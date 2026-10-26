/** Isolated gallery for headless screenshots of "Scanner avec l'iPhone" in
 * the vault's New card form (audit row 84): Settings > Vault, the real
 * component, with the server answered by the screenshot script (Playwright
 * routes). Not shipped in the app. ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CredentialsSettings } from "../components/settings/CredentialsSettings";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="min-h-screen bg-canvas p-6 text-ink">
        <div data-gallery-panel className="mx-auto max-w-[640px]">
          <CredentialsSettings />
        </div>
      </div>
    </StoreProvider>
  </StrictMode>,
);
