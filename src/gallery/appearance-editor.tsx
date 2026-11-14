/** Isolated gallery for headless screenshots of a bot's Edit bot >
 * Appearance page: the real persona editor (PersonaEditorModal) opened on
 * Appearance for a fictional bot wearing Shapes. The capture script
 * (scripts/capture/appearance-editor.mjs) clicks the tabs. Not shipped in
 * the app. ?skin=<id>&lang=<code>&character=<id>&color=<name>&shapeSkin=<id>&avatarDef=<json> */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { PersonaEditorModal } from "../components/persona/PersonaEditorModal";
import { resetAchievementsForTests } from "../lib/achievements";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot } from "../state/store";
import { NOTHING_LOCKED } from "../../shared/achievements";
import { botMascotLook } from "../../shared/mascot-look";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
// every character and skin owned, as on a server that does not gate them
resetAchievementsForTests({ unlocks: NOTHING_LOCKED });

const bot = {
  id: "melody",
  threadId: "t-melody",
  name: "Melody",
  title: "Research",
  description: "",
  notifications: true,
  color: params.get("color") ?? "orange",
  unread: false,
  avatarCrop: "mascot",
  // ?shapeSkin=<id>: the bot's shape skin (#4145 captures a premium one)
  // ?avatarDef=<json>: a pasted open-bot-avatar definition as the bot's own shape (#4160)
  mascotLook: botMascotLook({ character: params.get("character") ?? "shape", shape: "pumpkin", skins: { shape: params.get("shapeSkin") ?? "plain" }, ...(params.get("avatarDef") ? { avatarDef: JSON.parse(params.get("avatarDef") ?? "null") } : {}) }),
  modelSelection: { instanceId: "local", model: "test-model" },
  messages: [],
  tasks: [],
} as unknown as Bot;

function Open() {
  const { dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot], groups: [], sections: [], computerControl: {} } as never);
    dispatch({ type: "openPersonaEditor", botId: bot.id, section: "appearance" });
  }, [dispatch]);
  return <PersonaEditorModal />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <Open />
    </StoreProvider>
  </StrictMode>,
);
