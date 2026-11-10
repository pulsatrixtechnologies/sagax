// A turn that asked teammates, as one quiet centered line (#3289): "Asking
// [face] A, [face] B and [face] C" while any works, "Asked ..." when all
// are in; a request stopped before an answer, or one that could not be
// sent, is said on the same line. A name opens that teammate's exchange (the
// brief, then its answer) as the bot-to-bot sheet over this column. The
// Messaged line's row, faces and ink (BotNamesLine).
import { lazy, memo, Suspense, useState } from "react";
import type { Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { askLineVerb, type AskEntry } from "@/lib/ask-line";
import { listNames, NamesLine, type LineParty } from "./BotNamesLine";

const TeammateExchangeSheet = lazy(() => import("./TeammateExchangeSheet"));

/** What the line still says after the names: who stopped, who was never asked. */
export function askLineTail(asks: readonly Pick<AskEntry, "state" | "name">[]): string | undefined {
  const stopped = asks.filter((ask) => ask.state === "stopped").map((ask) => ask.name);
  const unsent = asks.filter((ask) => ask.state === "couldNotAsk").map((ask) => ask.name);
  const parts = [
    stopped.length ? t("chat.askLine.stopped", { names: listNames(stopped) }) : "",
    unsent.length ? t("chat.askLine.couldNotAsk", { names: listNames(unsent) }) : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

export const AskLine = memo(function AskLine({ asks, self, bots, mid, data }: {
  asks: readonly AskEntry[];
  /** The bot that asked: the left end of each exchange's sheet. */
  self?: Pick<Bot, "id" | "name" | "color">;
  bots: readonly Bot[];
  mid?: string;
  data?: Record<string, string>;
}) {
  "use memo";
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = openKey ? asks.find((ask) => ask.key === openKey) : undefined;
  const openBot = open ? bots.find((bot) => bot.id === open.botId) : undefined;
  const parties: LineParty[] = asks.map((ask) => ({
    key: ask.key,
    botId: ask.botId,
    name: ask.name,
    color: ask.color,
    title: ask.brief ? `${ask.name} · ${ask.brief}` : ask.name,
    onOpen: () => setOpenKey(ask.key),
  }));
  const tail = askLineTail(asks);
  return (
    <NamesLine
      testId="ask-line"
      verb={t(askLineVerb(asks) === "asking" ? "chat.askLine.asking" : "chat.askLine.asked")}
      parties={parties}
      bots={bots}
      tail={tail}
      tailTone="danger"
      mid={mid}
      data={{ "data-ask-line-state": askLineVerb(asks), ...data }}
    >
      {open && (
        <Suspense fallback={null}>
          <TeammateExchangeSheet
            owner={self}
            teammate={{ id: open.botId, name: open.name, color: openBot?.color ?? open.color }}
            threadId={open.threadId}
            task={open.brief}
            bots={[...(self ? bots.filter((bot) => bot.id === self.id) : []), ...(openBot ? [openBot] : [])]}
            onClose={() => setOpenKey(null)}
          />
        </Suspense>
      )}
    </NamesLine>
  );
});
