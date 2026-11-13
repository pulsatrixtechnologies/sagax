/** Isolated gallery for headless screenshots of a bot's Permissions card
 * (Approvals): the rows must share one inset, type and Switch. The capture
 * script (scripts/capture/bot-permissions-rows.mjs) answers /api itself.
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
// conversation runs at Ask (Full access waits for its confirmation), with
// Proactive on
const mismatch = params.get("level") === "mismatch";
// ?direct=1 (#2691): Proactive on, mail narrowed by filters, texts off, the
// calendar following the switch
const direct = params.get("direct") === "1";
// ?engine=grok|claude&connectors=on (#2747): the Grok account connectors row
// shows only on a Grok engine; ?part=advanced draws one sub-page
const engineParam = params.get("engine");
const part = (params.get("part") ?? "all") as Parameters<typeof PermissionsSection>[0]["part"];
const bot = {
  id: "cryptic", name: "Cryptic", approvalMode: "ask", approvePeerComms: true, emailDrafts: true, allowedRecipients: [], threadId: "t1",
  ...(mismatch ? { approvalSetting: "full", approvalApplied: { mode: "ask", reason: "consent" }, proactiveMode: "proactive" } : {}),
  ...(params.get("connectors") === "on" ? { grokAccountConnectors: true } : {}),
  ...(direct ? { proactiveMode: "proactive", directTriggers: { mail: { on: true, filters: "from:*@client.example, -infolettre" }, sms: { on: false } } } : {}),
} as unknown as Bot;
const derived = {
  patch: () => {},
  engine: engineParam === "grok" ? { instanceId: "grok", driverKind: "grokAgent", displayName: "Grok" }
    // ?engine=grokapi: the xAI API engine, where the row stays hidden
    : engineParam === "grokapi" ? { instanceId: "grok-api", driverKind: "grok", displayName: "Grok API" }
    : engineParam === "claude" ? { instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude" } : undefined, canCoordinate: true, approvalMode: mismatch ? "full" : "ask",
  trustedModesAvailable: false, sectionName: "", currentChief: undefined,
} as unknown as ReturnType<typeof useBotSettingsDerived>;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="min-h-screen bg-canvas p-6 text-ink">
        <div data-gallery-panel="" className="w-[560px] rounded-2xl border border-hairline/40 bg-panel px-4 pb-6 pt-4">
          <PermissionsSection bot={bot} derived={derived} part={part} />
        </div>
      </div>
    </StoreProvider>
  </StrictMode>,
);
