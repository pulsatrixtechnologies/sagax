/** Isolated gallery for headless screenshots of an open bot-to-bot
 * conversation ("A ⇆ B" header pill, Close Chat pill, #3245) over the whole chat column, so its
 * layout can be compared with a 1:1 chat at any window width. Neutral bot
 * names. Not shipped in the app. ?skin=<id>&lang=<code>&routine=1
 * (routine=1: a routine run's window, its X, meta line and pinned card). */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ExchangeColumnProvider, ExchangeSheet, useExchangeColumn } from "../components/BotExchangeChip";
import type { ExchangeRun } from "../lib/bot-exchange";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { Bot, Message } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const bots = [
  { id: "nova", name: "Nova", color: "blue", title: "Coordinator" },
  { id: "pixel", name: "Pixel", color: "orange", title: "Reports analyst" },
] as unknown as Bot[];
const nova = { botId: "nova", name: "Nova" };
const pixel = { botId: "pixel", name: "Pixel" };

// Fixed clock: today, 9:00 local.
const start = new Date();
start.setHours(9, 0, 0, 0);
let seq = 0;
function line(from: { botId: string; name: string }, text: string): Message {
  seq += 1;
  return { id: `m${seq}`, role: "bot", kind: "text", text, at: start.getTime() + seq * 60_000, from } as Message;
}

const messages = [
  line(nova, "Hi Pixel, can you check which weekly reports are still missing before Friday?"),
  line(pixel, "Sure. Here is what I found:\n\n| Team | Report | Status |\n| --- | --- | --- |\n| Design | Week 42 | Sent |\n| Support | Week 42 | Missing |\n| Platform | Week 42 | Draft |\n\nTwo of them still need work."),
  line(nova, "Thanks. Who owns the Support one?"),
  line(pixel, "The Support lead. Next steps:\n\n1. Remind the lead today.\n2. Merge the draft from Platform.\n3. Send the summary on Friday morning.\n\n```ts\nconst missing = reports.filter((r) => r.status !== \"sent\");\n```"),
  line(nova, "Perfect, I will tell the person who asked. A longer note so the bubble wraps on a wide window: the summary should list every team, the week, and whether the report was sent, drafted or still missing, with a link to each one."),
];
const run: ExchangeRun = {
  id: "exchange:m1",
  messages,
  party: { id: "pixel", name: "Pixel" },
  ends: [{ id: "nova", name: "Nova" }, { id: "pixel", name: "Pixel" }],
};

const routine = params.get("routine") === "1";

function Gallery() {
  const column = useExchangeColumn();
  return (
    <div className="h-screen bg-app text-ink" data-gallery="">
      <div ref={column.ref} className="relative h-full">
        <ExchangeColumnProvider node={column.node}>
          {column.node && (routine
            ? <ExchangeSheet
                chrome="window"
                run={{ ...run, ends: [{ id: "nova", name: "Nova" }] }}
                bots={bots}
                showToolCalls
                onClose={() => {}}
                testId="bot-exchange-sheet"
                meta={<span>Weekly reports · Today 9:00 · Done</span>}
                pinned={<div className="rounded-xl bg-raised px-3 py-2 text-[13px]">Approve sending the summary?</div>}
              />
            : <ExchangeSheet run={run} bots={bots} showToolCalls={false} onClose={() => {}} />)}
        </ExchangeColumnProvider>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
