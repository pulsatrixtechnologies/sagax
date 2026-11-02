/** Isolated gallery for Playwright screenshots of a stack of "Go to
 * conversation" lines, before (one line each) and after (one chip). Not
 * shipped in the app. ?skin=<id>&lang=<code>&view=before|after|named */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BotExchangeChip } from "../components/BotExchangeChip";
import { GotoGroupChip } from "../components/GotoGroupChip";
import { collapseGotoLines, gotoGroupFromConversations, silentChatItem, type GotoGroup } from "../lib/goto-lines";
import type { ExchangeRun } from "../lib/bot-exchange";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { Bot, Message } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const view = params.get("view") ?? "after";

const bots = [
  { id: "kat", name: "Katarina", color: "violet" },
  { id: "emb", name: "Ember", color: "orange" },
  { id: "ts", name: "Timesheets", color: "blue" },
  { id: "sales", name: "Sales", color: "green" },
  { id: "ag", name: "Agreements", color: "orange" },
] as unknown as Bot[];

const self = { id: "dispatch", name: "Dispatch", color: "green" as const };

let seq = 0;
function exchange(botId: string, name: string) {
  const id = `m${++seq}`;
  const message = { id, role: "bot", kind: "text", text: `${name}: done`, at: Date.now() + seq, from: { botId, name } } as Message;
  const run: ExchangeRun = { id: `exchange:${id}`, messages: [message], party: { id: botId, name }, ends: [{ id: "self", name: "Dispatch" }, { id: botId, name }] };
  return { kind: "exchange" as const, run };
}
const items = [
  exchange("ts", "Timesheets"),
  exchange("sales", "Sales"),
  exchange("ag", "Agreements"),
  exchange("sales", "Sales"),
  exchange("ag", "Agreements"),
  exchange("ts", "Timesheets"),
];
const group = collapseGotoLines(items, (item) => silentChatItem(item, false))[0] as GotoGroup;

const namedRows = [
  { threadId: "k1", otherBotId: "kat", otherName: "Katarina", direction: "out" as const, startedAt: 1, updatedAt: 2 },
  { threadId: "k2", otherBotId: "kat", otherName: "Katarina", direction: "in" as const, startedAt: 2, updatedAt: 3 },
  { threadId: "k3", otherBotId: "kat", otherName: "Katarina", direction: "out" as const, startedAt: 3, updatedAt: 4 },
  { threadId: "e1", otherBotId: "emb", otherName: "Ember", direction: "out" as const, startedAt: 4, updatedAt: 5 },
];
const namedGroup = gotoGroupFromConversations(namedRows, self)!;

function Gallery() {
  return (
    <div className="min-h-screen bg-app p-8 text-ink">
      <div className="relative mx-auto flex max-w-xl flex-col gap-3" data-gallery={view}>
        <div className="self-end rounded-[18px] bg-accent px-3 py-2 text-[13px] text-white">Catch me up on the bot-to-bot threads</div>
        {view === "before" ? (
          items.map((item) => <BotExchangeChip key={item.run.id} run={item.run} bots={bots} onGo={() => false} />)
        ) : view === "named" ? (
          <GotoGroupChip group={namedGroup} bots={bots} onSelect={() => false} />
        ) : (
          <GotoGroupChip group={group} bots={bots} onSelect={() => false} />
        )}
        <div className="self-start rounded-[18px] bg-card px-3 py-2 text-[13px] text-ink">Here is the summary: the pointers are grouped.</div>
        <div className="h-56" />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
