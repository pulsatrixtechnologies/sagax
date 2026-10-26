/** Isolated gallery for Playwright screenshots of bot mascots at the sizes
 * the sidebar (44, still) and the bot panel and editor (96 to 160) draw
 * them. Not shipped in the app. ?skin=<id>&still=1 draws every size still,
 * as the sidebar does. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { MASCOT_CHARACTERS, MASCOT_SHAPES, type MascotLook } from "../../shared/mascot-look";
import { type Bot } from "../state/store";
import { BotAvatar } from "../components/Avatar";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const still = params.get("still") === "1";

const SIZES = [44, 96, 112, 128, 160];
const COLORS = ["blue", "green", "orange", "purple", "pink", "teal", "red", "yellow"] as const;

const bot = (id: string, look: MascotLook, color: string): Bot =>
  ({ id, threadId: `t-${id}`, name: id, title: "", description: "", notifications: true, color, unread: false, mascotLook: look, messages: [], tasks: [] }) as unknown as Bot;

const rows: { id: string; look: MascotLook; color: string }[] = [
  ...MASCOT_SHAPES.map((shape, i) => ({ id: `shape-${shape}`, look: { character: "shape", shape } as MascotLook, color: COLORS[i % COLORS.length] })),
  ...MASCOT_CHARACTERS.filter((c) => c !== "shape").map((character, i) => ({ id: character, look: { character } as MascotLook, color: COLORS[i % COLORS.length] })),
];

function Gallery() {
  return (
    <div className="min-h-screen bg-app p-6 text-ink">
      <table>
        <thead>
          <tr>
            <th />
            {SIZES.map((size) => (
              <th key={size} className="px-3 pb-2 text-left text-xs text-ink-secondary">
                {size}px{size === 44 ? " (sidebar)" : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-row={row.id}>
              <td className="pr-4 text-xs text-ink-secondary">{row.id}</td>
              {SIZES.map((size) => (
                <td key={size} className="p-3 align-middle">
                  <BotAvatar bot={bot(row.id, row.look, row.color)} size={size} animated={!still && size > 60} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
