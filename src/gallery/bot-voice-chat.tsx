/** Isolated gallery for headless screenshots of the voice per bot (#M-20261119-013):
 * the voice bar's panel and the bot page's Voice chat card for two bots that
 * speak with two voices. The capture script (scripts/capture/bot-voice-chat.mjs)
 * answers /api itself. Not shipped. ?skin=<id>&lang=<code> */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { VoiceChatCard } from "../components/bot-settings/VoiceChatCard";
import { VoiceModeSettingsPanel, type VoiceModeList } from "../components/voice-mode/VoiceModeSettingsPanel";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { useVoiceModeSettings, voiceSettingsForBot, writeVoiceForBot } from "../lib/voice-mode/settings";
import { StoreProvider, type Bot } from "../state/store";
import { VOICE_MODE_STORAGE_KEY } from "../../shared/voice-mode";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
// the person's voice is Eve; Cryptic picked Ara of its own, Marc never picked
localStorage.setItem(VOICE_MODE_STORAGE_KEY, JSON.stringify({ voice: "eve", speed: 1, language: "auto", bots: { cryptic: { voices: { xai: "ara" } } } }));

const bot = (id: string, name: string) => ({ id, threadId: id, name, title: name, description: "", notifications: true, speakReplies: true, color: "green", unread: false, messages: [] }) as unknown as Bot;
const voices = [{ id: "eve", label: "Eve" }, { id: "ara", label: "Ara" }, { id: "rex", label: "Rex" }];

function Column({ b }: { b: Bot }) {
  const stored = useVoiceModeSettings();
  const [open, setOpen] = useState<VoiceModeList | null>(null);
  return (
    <div data-gallery-bot={b.id} className="flex w-[380px] flex-col gap-3">
      <h2 className="text-[15px] font-semibold">{b.name}</h2>
      <div className="rounded-2xl border border-hairline/40 bg-panel p-2" data-gallery-panel="bar">
        <VoiceModeSettingsPanel
          settings={voiceSettingsForBot(stored, b.id)}
          voices={voices}
          open={open}
          onOpen={setOpen}
          onChange={({ voice }) => { if (voice !== undefined) writeVoiceForBot(b.id, voice); }}
          onPreview={() => {}}
        />
      </div>
      <div className="rounded-2xl border border-hairline/40 bg-panel px-4 pb-4 pt-3" data-gallery-panel="page">
        <VoiceChatCard bot={b} onPatch={() => {}} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="flex min-h-screen items-start gap-8 bg-canvas p-6 text-ink">
        <Column b={bot("cryptic", "Cryptic")} />
        <Column b={bot("marc", "Marc")} />
      </div>
    </StoreProvider>
  </StrictMode>,
);
