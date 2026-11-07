/** Isolated gallery for screenshots of the Import an agent dialog (no
 * server). Not shipped in the app. ?skin=<id>&lang=<code>&source=grok|claude|hermes
 * scripts/capture/agent-import.mjs takes the shots (#2611: the Hermes tab
 * next to the Claude Code tab it mirrors). */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AgentImportDialog, type AgentSource } from "../components/AgentImport";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const sourceParam = params.get("source");
const source: AgentSource = sourceParam === "claude" || sourceParam === "hermes" ? sourceParam : "grok";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="h-[100dvh] w-full bg-app" data-gallery-frame="">
      <AgentImportDialog initialSource={source} onClose={() => {}} />
    </div>
  </StrictMode>,
);
