// #4238: what a teammate's request concluded for the person.
//
// PeerOutcomeLine: the one synthesized line in the person's conversation
// with their bot when a teammate's request left something for them, drawn
// with NamesLine like "Asked by" ("From [face] Nova · 2 things need you, 1
// thing to know"). The cards themselves are in the pinned zone; the line
// never quotes the bot-to-bot text. The name opens the exchange, with what
// it concluded under it.
//
// PeerOutcomeSummary: that conclusion (nothing, told, asked, each item), the
// footer of the exchange sheet an "Asked by" line opens, so the person can
// check that nothing was skipped.
import { lazy, Suspense, useState } from "react";
import type { Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { peerOutcomeCounts } from "@/lib/peer-outcome-line";
import type { PeerOutcome } from "../../shared/peer-outcome";
import { NamesLine } from "./BotNamesLine";

const TeammateExchangeSheet = lazy(() => import("./TeammateExchangeSheet"));

/** "2 things need you, 1 thing to know", or "Nothing for you". */
export function peerOutcomeWords(outcome: Pick<PeerOutcome, "items">): string {
  const { needs, know } = peerOutcomeCounts(outcome);
  const parts = [
    ...(needs ? [t(needs === 1 ? "chat.peerOutcome.needs.one" : "chat.peerOutcome.needs.other", { count: needs })] : []),
    ...(know ? [t(know === 1 ? "chat.peerOutcome.know.one" : "chat.peerOutcome.know.other", { count: know })] : []),
  ];
  return parts.length ? parts.join(", ") : t("chat.peerOutcome.nothing");
}

export function PeerOutcomeSummary({ outcome }: { outcome: PeerOutcome }) {
  return (
    <div data-peer-outcome={outcome.kind} className="w-full text-left text-[12px] leading-[1.45] text-ink-secondary">
      <div className="font-medium text-ink">{t("chat.peerOutcome.title")}</div>
      {outcome.items.length === 0 ? (
        <div data-peer-outcome-nothing="" className="text-ink-tertiary">{t("chat.peerOutcome.nothing")}</div>
      ) : (
        <ul className="mt-1 space-y-1">
          {outcome.items.map((item) => (
            <li key={item.key} data-peer-outcome-item={item.kind} className="flex gap-2">
              <span className={item.kind === "tell" || item.answered ? "shrink-0 text-ink-tertiary" : "shrink-0 text-accent-text"}>
                {t(item.answered ? "chat.peerOutcome.kind.answered" : item.kind === "tell" ? "chat.peerOutcome.kind.tell" : item.kind === "fix" ? "chat.peerOutcome.kind.fix" : "chat.peerOutcome.kind.ask")}
              </span>
              <span className="min-w-0 break-words">{item.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PeerOutcomeLine({ outcome, botId, bots, mid }: {
  outcome: PeerOutcome;
  /** The bot whose chat this is: it answered the request. */
  botId: string;
  bots: readonly Bot[];
  mid?: string;
}) {
  const [open, setOpen] = useState(false);
  const self = bots.find((bot) => bot.id === botId);
  const asker = outcome.from ? bots.find((bot) => bot.id === outcome.from!.botId) : undefined;
  const name = asker?.name ?? outcome.from?.name ?? self?.name ?? t("chat.askLine.aTeammate");
  const partyId = asker?.id ?? outcome.from?.botId ?? botId;
  const { needs } = peerOutcomeCounts(outcome);
  return (
    <NamesLine
      testId="peer-outcome-line"
      verb={t("chat.peerOutcome.from")}
      parties={[{
        key: outcome.threadId,
        botId: partyId,
        name,
        color: asker?.color,
        label: t("chat.peerOutcome.openAria", { name }),
        data: { "data-peer-outcome-open": outcome.threadId },
        onOpen: () => setOpen(true),
      }]}
      bots={bots}
      tail={peerOutcomeWords(outcome)}
      tailTone={needs ? "accent" : undefined}
      mid={mid}
      data={{ "data-peer-outcome-line": outcome.kind }}
    >
      {open ? (
        <Suspense fallback={null}>
          <TeammateExchangeSheet
            owner={outcome.from ? { id: partyId, name, color: (asker?.color ?? "blue") as never } : undefined}
            teammate={{ id: botId, name: self?.name ?? "", color: self?.color }}
            threadId={outcome.threadId}
            bots={bots.filter((bot) => bot.id === partyId || bot.id === botId)}
            footer={<PeerOutcomeSummary outcome={outcome} />}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      ) : null}
    </NamesLine>
  );
}
