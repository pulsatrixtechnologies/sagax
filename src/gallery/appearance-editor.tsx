/** Isolated gallery for headless screenshots of a bot's look: the real
 * bot page (PersonaEditorModal) opened on Appearance for a fictional bot
 * wearing Shapes, so the mascot picker hangs under the page's mascot
 * (#5369). The capture script (scripts/capture/mascot-picker.mjs) opens its
 * tabs and small panels. Not shipped in the app. ?skin=<id>&lang=<code>&character=<id>&color=<name>&shapeSkin=<id>&avatarDef=<json>
 * #5349: &shape=<id>&material=flat|fluffy|glass&mood=neutral|happy&eyeColor=<#rrggbb>&depth=<0..14>
 * are the engine's look settings on the bot; &bodyColor=<#rrggbb>&motion=reduced|full the picker's own;
 * &locked=1 keeps the looks behind their achievements (padlocks); &live=all makes every thumbnail live (measure). */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { PersonaEditorModal } from "../components/persona/PersonaEditorModal";
import { setGridLiveForMeasure } from "../components/floating-bots/MascotPicker";
import { resetAchievementsForTests } from "../lib/achievements";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot } from "../state/store";
import { LOCKED_UNTIL_LOADED, NOTHING_LOCKED } from "../../shared/achievements";
import { botMascotLook } from "../../shared/mascot-look";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
// &live=all: every thumbnail of the picker's grid live, to measure what that costs
if (params.get("live") === "all") setGridLiveForMeasure("all");
// every character and skin owned, as on a server that does not gate them; &locked=1 shows the padlocks
resetAchievementsForTests({ unlocks: params.get("locked") ? LOCKED_UNTIL_LOADED : NOTHING_LOCKED });

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
  mascotLook: botMascotLook({ character: params.get("character") ?? "shape", shape: params.get("shape") ?? "pumpkin", skins: { shape: params.get("shapeSkin") ?? "plain" }, ...(params.get("avatarDef") ? { avatarDef: JSON.parse(params.get("avatarDef") ?? "null") } : {}), ...(params.get("material") ? { material: params.get("material") } : {}), ...(params.get("mood") ? { mood: params.get("mood") } : {}), ...(params.get("eyeColor") ? { eyeColor: params.get("eyeColor") } : {}), ...(params.get("depth") ? { depth: Number(params.get("depth")) } : {}), ...(params.get("bodyColor") ? { bodyColor: params.get("bodyColor") } : {}), ...(params.get("motion") ? { motion: params.get("motion") } : {}) }),
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
