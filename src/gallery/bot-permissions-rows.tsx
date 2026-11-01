/** Isolated gallery for headless screenshots of a bot's Permissions card
 * (Approvals): the rows must share one inset, type and Switch. The capture
 * script (scripts/capture-bot-permissions-rows.mjs) answers /api itself.
 * Not shipped. ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PermissionsSection } from "../components/bot-settings/PermissionsSection";
import type { useBotSettingsDerived } from "../components/bot-settings/useBotSettingsDerived";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

// ?level=mismatch (2026-10-28): the bot is on Full access while its open
// conversation runs at Ask (an engine change asked again there), with
// Proactive on
const mismatch = params.get("level") === "mismatch";
const bot = {
  id: "cryptic", name: "Cryptic", approvalMode: "ask", approvePeerComms: true, emailDrafts: true, allowedRecipients: [], threadId: "t1",
  ...(mismatch ? { approvalSetting: "full", approvalApplied: { mode: "ask", reason: "engine" }, proactiveMode: "proactive" } : {}),
} as unknown as Bot;
const derived = {
  patch: () => {}, engine: undefined, canCoordinate: true, approvalMode: mismatch ? "full" : "ask",
  trustedModesAvailable: false, sectionName: "", currentChief: undefined,
} as unknown as ReturnType<typeof useBotSettingsDerived>;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="min-h-screen bg-canvas p-6 text-ink">
        <div data-gallery-panel="" className="w-[560px] rounded-2xl border border-hairline/40 bg-panel px-4 pb-6 pt-4">
          <PermissionsSection bot={bot} derived={derived} />
        </div>
      </div>
    </StoreProvider>
  </StrictMode>,
);
