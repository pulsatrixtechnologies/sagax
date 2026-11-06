/** Isolated gallery for headless screenshots of Settings > App > Startup and
 * windows > App icon: the real AppIconPicker with a fake desktop bridge that
 * keeps the chosen icon. Not shipped in the app. ?skin=<id>&lang=<code> */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { AppIconPicker } from "../components/settings/AppIconPicker";
import { resetAchievementsForTests } from "../lib/achievements";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot } from "../state/store";
import { NOTHING_LOCKED } from "../../shared/achievements";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
resetAchievementsForTests({ unlocks: NOTHING_LOCKED });

let saved: string | null = null;
(window as unknown as { ogb: unknown }).ogb = {
  platform: "darwin",
  appIcon: {
    get: async () => ({ id: saved, platform: "darwin" }),
    set: async (input: { id: string; images: { size: number }[] }) => {
      saved = input.id;
      (window as unknown as { __appIconSet: unknown }).__appIconSet = { id: input.id, sizes: input.images.map((image) => image.size) };
      return { id: input.id, platform: "darwin" };
    },
    reset: async () => ({ id: null, platform: "darwin" }),
  },
};

const bot = { id: "primary-bot", threadId: "t1", name: "Melody", title: "", description: "", notifications: true, color: "orange", unread: false, chiefOfStaff: true, avatarCrop: "mascot", messages: [], tasks: [] } as unknown as Bot;

function Page() {
  const { dispatch } = useStore();
  useEffect(() => { dispatch({ type: "hydrate", bots: [bot], groups: [], sections: [], computerControl: {} } as never); }, [dispatch]);
  return <div style={{ padding: 24, maxWidth: 760 }}><AppIconPicker /></div>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <Page />
    </StoreProvider>
  </StrictMode>,
);
