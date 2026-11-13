/** Isolated gallery for headless screenshots of an open bot-to-bot
 * conversation ("A ⇆ B" header pill, Close Chat pill, #3245) over the whole chat column, so its
 * layout can be compared with a 1:1 chat at any window width. Neutral bot
 * names. Not shipped in the app. ?skin=<id>&lang=<code>&routine=1&subject=<kind>
 * (routine=1: a routine run's window, its X, meta line and pinned card;
 * subject=long|short|first: the subject under the pill, #4043: a page of
 * text, one short line, or the first line's own text; tools=1: Settings >
 * Tool calls on, #4171: the steps between the lines show only then, a failed
 * hand-off to a teammate shows either way). */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ExchangeColumnProvider, ExchangeSheet, useExchangeColumn } from "../components/BotExchangeChip";
import type { ExchangeRun } from "../lib/bot-exchange";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, type AppState, type Bot, type Message, type useStore } from "../state/store";
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
function step(from: { botId: string; name: string }, name: string, input: Record<string, unknown>, ok = true): Message {
  seq += 1;
  return { id: `m${seq}`, role: "bot", kind: "activity", text: "", at: start.getTime() + seq * 60_000, from, tool: { name, ok, durationMs: 1_200, input: JSON.stringify(input) } } as Message;
}

const subjectKind = params.get("subject");
const brief = [
  "Hi Pixel, can you check which weekly reports are still missing before Friday?",
  "For each team, open the shared folder for the week, compare the files with the list of teams, and note whether the report was sent, drafted or is still missing.",
  "When a report is a draft, read it and say what is left to write: the numbers, the summary or the review.",
  "When a report is missing, find who owns it from the team page and write down their name and the last time they sent one.",
  "Then group the results by status, missing first, and add the link to each file so the person can open it in one click.",
  "Keep the tone short and plain, one line per team, and end with the three next steps you would take today.",
  "If a folder cannot be opened, say which one and why, and go on with the others instead of stopping.",
  "Last, compare with last week: a team that was late twice in a row gets a note so the person can follow up.",
].join(" ");
const subject = subjectKind === "long" || subjectKind === "first" ? brief
  : subjectKind === "short" ? "Weekly reports check"
  : undefined;

const messages = [
  line(nova, subjectKind === "first" ? brief : "Hi Pixel, can you check which weekly reports are still missing before Friday?"),
  line(pixel, "Sure. Here is what I found:\n\n| Team | Report | Status |\n| --- | --- | --- |\n| Design | Week 42 | Sent |\n| Support | Week 42 | Missing |\n| Platform | Week 42 | Draft |\n\nTwo of them still need work."),
  line(nova, "Thanks. Who owns the Support one?"),
  step(pixel, "Bash", { command: "ls reports/week-42" }),
  step(pixel, "ToolSearch", { query: "shared folder" }),
  step(pixel, "Read", { file_path: "/srv/reports/week-42/platform.md" }),
  step(pixel, "ask_bot", { bot: "Atlas", message: "Who owns the Support report?" }, false),
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
const tools = params.get("tools") === "1";
// The person's setting comes from the store, as in the app.
const store = {
  state: { ...initialState, config: { features: { showToolCalls: tools } } as AppState["config"] },
  dispatch: () => {},
  flushBotPatches: () => {},
  refreshInstances: async () => {},
  refreshModels: async () => {},
} as unknown as ReturnType<typeof useStore>;

function Gallery() {
  const column = useExchangeColumn();
  return (
    <BotEditorStore value={store}>
    <div className="h-screen bg-app text-ink" data-gallery="">
      <div ref={column.ref} className="relative h-full">
        <ExchangeColumnProvider node={column.node}>
          {column.node && (routine
            ? <ExchangeSheet
                chrome="window"
                run={{ ...run, ends: [{ id: "nova", name: "Nova" }] }}
                bots={bots}
                onClose={() => {}}
                testId="bot-exchange-sheet"
                meta={<span>Weekly reports · Today 9:00 · Done</span>}
                pinned={<div className="rounded-xl bg-raised px-3 py-2 text-[13px]">Approve sending the summary?</div>}
              />
            : <ExchangeSheet run={run} bots={bots} subject={subject} onClose={() => {}} />)}
        </ExchangeColumnProvider>
      </div>
    </div>
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
