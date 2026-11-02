/** Isolated gallery for headless screenshots of who speaks and who listens
 * (2026-10-29): Edit bot > Voice, its new provider group above the bot's
 * voice, read aloud and voice notes, and the person's own group of
 * Settings > Voice. `?before=1` draws the page without the new group.
 * The capture script (scripts/capture/voice-providers.mjs) answers /api
 * itself. Not shipped. ?skin=<id>&lang=<code>&before=1 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { VoiceProviderSettings } from "../components/settings/VoiceProviderSettings";
import { VoiceSettings } from "../components/VoiceSettings";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot } from "../state/store";
import { VOICE_MODE_STORAGE_KEY } from "../../shared/voice-mode";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const before = params.get("before") === "1";
try {
  localStorage.setItem(VOICE_MODE_STORAGE_KEY, JSON.stringify({ voice: "eve", speed: 1, language: "auto", tts: "openai", voices: { openai: "cedar" }, bots: { cryptic: { tts: "elevenlabs", voices: { elevenlabs: "myClonedVoice01" } } } }));
} catch { /* the gallery draws the defaults */ }

const bot = { id: "cryptic", threadId: "t1", name: "Cryptic", title: "Cryptic", description: "", notifications: true, speakReplies: true, color: "green", unread: false, messages: [] } as unknown as Bot;

function Ready({ children }: { children: React.ReactNode }) {
  const { dispatch } = useStore();
  // an organization server whose installation has no voice engine of its own
  useEffect(() => { dispatch({ type: "configStatus", config: { tts: { configured: false, provider: "elevenlabs" } } as never }); }, [dispatch]);
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider><Ready>
      <div className="flex min-h-screen items-start gap-6 bg-canvas p-6 text-ink">
        <aside data-gallery-panel="bot" className="w-[420px] rounded-2xl border border-hairline/40 bg-panel px-4 pb-6 pt-4">
          <h2 className="mb-3 text-[15px] font-semibold">{t("botPanel.voice.voice")}</h2>
          <div className="flex flex-col gap-5">
            {!before && <VoiceProviderSettings bot={bot} />}
            <VoiceSettings bot={bot} onPatch={() => {}} />
          </div>
        </aside>
        {!before && (
          <section data-gallery-panel="person" className="w-[560px] rounded-2xl border border-hairline/40 bg-panel p-4">
            <VoiceProviderSettings />
          </section>
        )}
      </div>
    </Ready></StoreProvider>
  </StrictMode>,
);
