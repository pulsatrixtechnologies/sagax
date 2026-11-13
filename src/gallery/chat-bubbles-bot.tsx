/** Isolated gallery for headless screenshots of my bubble in a bot's colour
 * (2026-10-28): on a skin whose accent is a neutral (Studio: Midnight dark,
 * Daylight light) my bubble in a 1:1 takes the bot's colour, the bot's reply
 * stays grey; a room takes the brand's accent. Not shipped in the app.
 * ?skin=<id>&lang=<code>&mode=after|before (before: the skin's bubble everywhere)
 * &colors=all: one column per colour of the mascot palette (#4096, white ink). */
import { StrictMode, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { botBubbleVars } from "../lib/bubble-colors";
import { loadLocale, t } from "../lib/i18n";
import { MAUS_COLORS, MAUS_COLOR_NAMES, type MausColor } from "../lib/mascot";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
const skin: SkinId = skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin();
applySkin(skin);
await loadLocale(params.get("lang") ?? "en");
const before = params.get("mode") === "before";

const answer = "Done: **3 tickets** updated. See [the report](https://example.com) and `ticket.close`.";

function Column({ label, color, room }: { label: string; color?: MausColor; room?: boolean }) {
  const style = !before && color ? (botBubbleVars(MAUS_COLORS[color]) as CSSProperties) : undefined;
  return (
    <div style={style} data-room-bubble={!before && room ? "" : undefined} className="flex w-[260px] flex-col gap-2 bg-app p-4 text-ink" data-gallery-column={label}>
      <div className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
        {color && <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: MAUS_COLORS[color] }} />}
        {label}
      </div>
      <div className="flex flex-col items-end">
        <div className="chat-text w-fit max-w-[92%] rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px] leading-5 text-ink" data-chat-bubble data-who="user">
          Close #1042, see <a className="text-accent-text underline" href="https://example.com">the doc</a> and <code className="rounded bg-inset px-1 font-mono text-[12px]">ticket.close</code>.
          <div className="mt-1 text-[11px] text-ink-tertiary">{t("chat.sentMidTurn")}</div>
        </div>
      </div>
      <div className="flex flex-col items-start">
        <div className="w-fit max-w-[94%] rounded-[18px] bg-bubble-bot px-3 py-[7px] text-[13px] leading-5 text-ink" data-chat-bubble data-who="bot">
          <ChatMarkdown text={answer} />
        </div>
      </div>
    </div>
  );
}

const ALL = params.get("colors") === "all";
const COLUMNS: Array<{ label: string; color?: MausColor; room?: boolean }> = ALL ? MAUS_COLOR_NAMES.map((color) => ({ label: color, color })) : [
  { label: "Bot: orange", color: "orange" },
  { label: "Bot: red", color: "red" },
  { label: "Bot: green", color: "green" },
  { label: "Bot: blue", color: "blue" },
  { label: "Bot: purple", color: "purple" },
  { label: "Room (no colour)", room: true },
];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="flex flex-wrap items-start gap-0 bg-app" data-gallery>
      {COLUMNS.map((c) => <Column key={c.label} {...c} />)}
    </div>
  </StrictMode>,
);
