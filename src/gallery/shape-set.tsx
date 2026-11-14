/** Isolated gallery for Playwright screenshots of every shape (2026-10-28):
 * the whole set live with its eyes, in the bots' colors, the pumpkin in
 * orange. Not shipped in the app. scripts/capture/shape-mascots.mjs captures
 * it in every mood (#4145: drawn by the open-bot-avatar engine).
 * ?skin=<app skin> (pulsatrix dark, pulsatrix-light light), ?move=<shape move>
 * plays that move on every shape every few seconds, ?still=1 draws the still
 * pose, ?size=<px>, ?only=<shape> draws one shape larger, ?shapeSkin=<skin>
 * dresses every shape in that skin, ?mood=<mood> sets the mood,
 * ?color=<bot color> paints every shape in one color. */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { MASCOT_SHAPES, SHAPE_SKINS, type MascotShape, type ShapeSkin } from "../../shared/mascot-look";
import { ShapeMascot, type ShapeMood } from "../components/ShapeMascot";
import { isShapeMove } from "../components/shape-engine";
import { SHAPE_LABEL } from "../components/floating-bots/MascotLookEditor";
import { t } from "../lib/i18n";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const still = params.get("still") === "1";
const moveParam = params.get("move");
const move = isShapeMove(moveParam) ? moveParam : null;
const only = params.get("only") as MascotShape | null;
const size = Number(params.get("size") ?? (only ? 220 : 96));
const shapeSkinParam = params.get("shapeSkin");
const shapeSkin: ShapeSkin = (SHAPE_SKINS as readonly string[]).includes(shapeSkinParam ?? "") ? (shapeSkinParam as ShapeSkin) : "plain";
const MOODS: readonly ShapeMood[] = ["idle", "thinking", "working", "streaming", "happy", "blocked", "sleeping"];
const moodParam = params.get("mood");
const mood: ShapeMood = (MOODS as readonly string[]).includes(moodParam ?? "") ? (moodParam as ShapeMood) : "idle";
const colorParam = params.get("color");

const COLORS = ["blue", "green", "orange", "purple", "pink", "teal", "red", "yellow"] as const;
const shapes: readonly MascotShape[] = only && (MASCOT_SHAPES as readonly string[]).includes(only) ? [only] : MASCOT_SHAPES;

function Gallery() {
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (!move) return;
    const first = setTimeout(() => setKey(1), 400);
    const every = setInterval(() => setKey((k) => k + 1), 4000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);
  return (
    <div className="min-h-screen bg-app p-6 text-ink" data-shot="">
      <div className="grid gap-x-2 gap-y-4" style={{ gridTemplateColumns: `repeat(${only ? 1 : 8}, ${size + 24}px)` }}>
        {shapes.map((shape, i) => (
          <figure key={shape} data-shape-cell={shape} className="flex flex-col items-center gap-1">
            <ShapeMascot
              shape={shape}
              skin={shapeSkin}
              color={colorParam ?? (shape === "pumpkin" ? "orange" : COLORS[i % COLORS.length])}
              size={size}
              mood={mood}
              animated={!still}
              move={move && key ? { clip: move, key } : null}
              label={shape}
            />
            <figcaption className="text-xs text-ink-secondary">{t(SHAPE_LABEL[shape])}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
