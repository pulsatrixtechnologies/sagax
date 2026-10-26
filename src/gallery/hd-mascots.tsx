/** Isolated gallery for Playwright screenshots of the HD mascots
 * (src/components/hd-mascots). Not shipped in the app.
 * ?state=<MausState> draws one Shiba bot large in that state;
 * ?hd=off draws the classic vector look (the "HD mascots" switch off);
 * ?still=1 draws it still (as under reduced motion);
 * ?skin=<id> the app skin. Without ?state, a sheet of states. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { setHdMascotsEnabled } from "../lib/hd-mascots-preference";
import { MAUS_STATES, type MausState } from "../lib/mascot";
import type { MascotLook } from "../../shared/mascot-look";
import { type Bot } from "../state/store";
import { BotAvatar } from "../components/Avatar";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setHdMascotsEnabled(params.get("hd") !== "off");
const still = params.get("still") === "1";
const stateParam = params.get("state");
const state = stateParam && (MAUS_STATES as readonly string[]).includes(stateParam) ? (stateParam as MausState) : null;

const bot = { id: "shiba", threadId: "t-shiba", name: "Shiba", title: "", description: "", notifications: true, color: "orange", unread: false, mascotLook: { character: "shiba" } as MascotLook, messages: [], tasks: [] } as unknown as Bot;

const SHEET: MausState[] = ["idle", "happy", "sad", "celebrate", "thinking", "writing", "angry", "surprised", "confused", "sleeping", "laughing", "shy"];

function Gallery() {
  if (state) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface p-6 text-ink">
        <figure data-shot className="flex flex-col items-center gap-2 rounded-2xl bg-panel p-6">
          <BotAvatar bot={bot} size={256} state={state} animated={!still} />
          <figcaption className="text-xs text-ink-secondary">
            {state} · {params.get("hd") === "off" ? "classic" : "HD"}
            {still ? " · still" : ""}
          </figcaption>
        </figure>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-surface p-6 text-ink">
      <div data-shot className="grid grid-cols-6 gap-4">
        {SHEET.map((s) => (
          <figure key={s} className="flex flex-col items-center gap-1">
            <BotAvatar bot={bot} size={128} state={s} animated={!still} />
            <figcaption className="text-xs text-ink-secondary">{s}</figcaption>
          </figure>
        ))}
        <figure className="flex flex-col items-center gap-1">
          <BotAvatar bot={bot} size={44} animated={false} />
          <figcaption className="text-xs text-ink-secondary">44 px</figcaption>
        </figure>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
