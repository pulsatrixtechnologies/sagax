/** Isolated gallery for Playwright screenshots (not shipped in the app): every
 * built-in mascot, and one custom mascot, drawn twice side by side: the bot
 * list's avatar, and the desktop companion fed the way the app feeds it (the
 * look sanitized by Electron main, then the floating window's Character).
 * ?skin=<id> the app skin. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { MASCOT_CHARACTERS, MASCOT_SHAPES, type MascotLook } from "../../shared/mascot-look";
import { OBJECT_SHAPE_BY_ID } from "../../shared/shape-avatar-presets";
import { type Bot } from "../state/store";
import { BotAvatar } from "../components/Avatar";
import { Character } from "../components/floating-bots/FloatingBotDecor";
import { mascotMotion, newMascotState } from "../components/floating-bots/behavior";
import { OWL_SIZE } from "../components/floating-bots/stage-size";
// @ts-expect-error plain JS module of Electron main, no types
import { mascotLook as mainMascotLook } from "../../electron/floating-bot-window.mjs";
import "../styles.css";
import "../components/floating-bots/floating-bots.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());

const COLOR = "green";
const LOOKS: { label: string; look: MascotLook }[] = [
  ...MASCOT_CHARACTERS.filter((character) => character !== "shape").map((character) => ({ label: character, look: { character } as MascotLook })),
  ...MASCOT_SHAPES.map((shape) => ({ label: `shape: ${shape}`, look: { character: "shape", shape } as MascotLook })),
  { label: "custom mascot", look: { character: "shape", shape: "circle", avatarDef: { ...OBJECT_SHAPE_BY_ID.cup, id: "my-own-mascot", name: "My own" } } as MascotLook },
];

const MASCOT = {
  frame: (at: number) => mascotMotion(newMascotState(0), { now: at, pose: "idle", reduced: true, gaze: null }),
  fps: () => 0,
  onHitTest: () => {},
};

function Pair({ label, look }: { label: string; look: MascotLook }) {
  const bot = { id: label, threadId: `t-${label}`, name: label, title: "", description: "", notifications: true, color: COLOR, unread: false, mascotLook: look, messages: [], tasks: [] } as unknown as Bot;
  // what the companion window receives: the snapshot crosses Electron main
  const desktop = mainMascotLook(JSON.parse(JSON.stringify(look))) ?? undefined;
  return (
    <figure data-pair={label} className="flex flex-col items-center gap-2 rounded-xl border border-hairline bg-panel p-3">
      <div className="flex items-end gap-4">
        <div data-side="list" className="flex flex-col items-center gap-1">
          <BotAvatar bot={bot} size={72} />
          <span className="text-[11px] text-ink-secondary">List</span>
        </div>
        <div data-side="desktop" className="fb-root flex flex-col items-center gap-1" style={{ width: OWL_SIZE }}>
          <span className="relative block" style={{ width: OWL_SIZE, height: OWL_SIZE }}>
            <Character color={COLOR} skin={skinParam ?? "pulsatrix"} avatarSrc={null} avatarX={0.5} avatarY={0.5} look={desktop ? JSON.stringify(desktop) : ""} pose="idle" activity={"idle" as never} mascot={MASCOT as never} />
          </span>
          <span className="text-[11px] text-ink-secondary">Desktop</span>
        </div>
      </div>
      <figcaption className="text-xs font-medium text-ink">{label}</figcaption>
    </figure>
  );
}

function Gallery() {
  return (
    <main data-shot className="min-h-screen bg-app p-6 text-ink">
      <h1 className="mb-4 text-sm font-semibold">Desktop companion vs list avatar</h1>
      <div className="grid grid-cols-4 gap-3">
        {LOOKS.map((entry) => <Pair key={entry.label} {...entry} />)}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
