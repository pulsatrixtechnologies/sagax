/** Gallery for screenshots: the bot panel's Computer row with the selected
 * computer's capture (the capture script answers the thumbnail endpoint),
 * an old capture greyed out, a computer without one (unavailable, with the
 * reason), a stopped cloud computer and a bot set to Off (asleep), and a
 * Browser-only bot (no computer).
 * Picking another computer in the row's menu switches the picture. Not
 * shipped. ?skin=<id>&lang=<code> */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ComputerCard } from "../components/bot-settings/ComputerCard";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const sample = (id: string, name: string, computer: Bot["computer"]) =>
  ({ id, name, title: "", description: "", messages: [], tasks: [], threadId: `t-${id}`, busy: false, computer }) as never as Bot;

function Row({ initial }: { initial: Bot }) {
  const [bot, setBot] = useState(initial);
  return <ComputerCard bot={bot} onPatch={(patch) => setBot({ ...bot, computer: patch.computer ?? undefined })} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <aside data-gallery-panel="" className="min-h-screen w-[380px] border-r border-hairline/40 bg-panel text-ink">
        <div className="flex flex-col gap-6 px-4 pb-6 pt-4">
          <div data-gallery-row="fresh"><Row initial={sample("scout", "Scout", "cloud")} /></div>
          <div data-gallery-row="stale"><Row initial={sample("echo", "Echo", "vm")} /></div>
          <div data-gallery-row="none"><Row initial={sample("pepper", "Pepper", "local")} /></div>
          <div data-gallery-row="asleep"><Row initial={sample("luna", "Luna", "cloud")} /></div>
          <div data-gallery-row="off"><Row initial={sample("nova", "Nova", "off")} /></div>
          <div data-gallery-row="browser"><Row initial={sample("iris", "Iris", "browser")} /></div>
        </div>
      </aside>
    </StoreProvider>
  </StrictMode>,
);
