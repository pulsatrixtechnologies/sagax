/** Isolated gallery of the real resolved-list renderer, with invented
 * capabilities only. ?skin=<id>&lang=en|fr&details=1&partial=1&rea=on|off|missing. */
import { createRoot } from "react-dom/client";
import { CapabilitiesBody } from "../components/bot-settings/CapabilitiesTab";
import { capabilityFixture, reaCapabilityFixture } from "../lib/capabilities.fixture";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skin = params.get("skin") as SkinId | null;
applySkin(skin && (SKIN_IDS as readonly string[]).includes(skin) ? skin : readSkin());
await loadLocale(params.get("lang") ?? "en");
const data = capabilityFixture(params.has("partial") ? {
  promptIndex: { bytes: 900, maxBytes: 4_000, skills: 2, maxSkills: 30, omitted: 0, incomplete: true },
} : {});
const rea = params.get("rea");
if (rea) data.items.unshift(reaCapabilityFixture(rea === "off"
  ? { state: "off", enabled: false, reason: "disabled", mounts: undefined, engine: { mcp: "none", nothing: true } }
  : rea === "missing" ? { state: "not_served", reason: "needs_runtime", mounts: undefined, engine: { mcp: "none", nothing: true } } : {}));
createRoot(document.getElementById("root")!).render(
  <main className="min-h-screen max-w-[680px] bg-panel py-4 text-ink">
    <CapabilitiesBody botName="Scout" data={data} onAdd={() => {}}
      openAll={params.has("details")} />
  </main>,
);
