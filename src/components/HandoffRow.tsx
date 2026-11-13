// A bot-to-bot hand-off in the unified chat (threads off): the quiet
// centered line every bot-to-bot trace uses (#3289, BotNamesLine), never a
// left-aligned step row. The sender's chat reads "Asking [face] Olive" while
// the teammate works and "Asked [face] Olive" once its answer is in (a run of
// receipts folds into one line, lib/ask-line).
//
// #3581: the other direction is the same line, never a quote: "Asked by
// [face] Wren" for a request this bot received (and for a stored copy of an
// AI client's or a teammate's request), "Answer from [face] Olive" for an
// answer whose receipt is not on this page, "Message from [face] Wren" for a
// notice another bot's thread surfaced. A run folds into one line, one name
// per party and "5 requests" when there are more requests than names
// (lib/incoming-line). #4112: a line the person sent on their phone line is
// the same row, "Asked by [phone] Text Message (514 555-0142)", the bot's
// answer kept behind it as a teammate's is. A name opens that party's
// exchanges of the line, newest first: the request, then the answer, in the
// bot-to-bot sheet over this column. Never a thread link: everything stays in this chat (#2901).
import { lazy, memo, Suspense, useState } from "react";
import type { Bot, Message } from "@/state/store";
import { useStoreSelector } from "@/state/store-selector";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { handoffResultIn, handoffRequestId, handoffResultId } from "@/lib/handoff-row";
import { askEntry } from "@/lib/ask-line";
import { incomingEntry, incomingParties, incomingTail, type IncomingEntry, type IncomingLineItem, type IncomingParty } from "@/lib/incoming-line";
import { AGENT_OPENER_PREFIX } from "../../shared/agent-conversation";
import { AskLine } from "./AskLine";
import { NamesLine, type LineParty } from "./BotNamesLine";
import { ExchangeSheet } from "./BotExchangeChip";
import { PILL } from "./SettingsPrimitives";
import { useChatRows } from "./ChatView.tsx-parts/types";

const TeammateExchangeSheet = lazy(() => import("./TeammateExchangeSheet"));

const VERB: Record<IncomingLineItem["verb"], LocaleKey> = {
  askedBy: "chat.incoming.askedBy",
  messageFrom: "chat.incoming.messageFrom",
  answerFrom: "chat.incoming.answerFrom",
};

/** `lead` and `detail`: a phone line's name split for the line, the source
 * ("Text Message") that may give way and the number that never does (#4112). */
type Party = Pick<Bot, "id" | "name"> & { color?: string; lead?: string; detail?: string };

/** The party as the line and the sheet name it. */
function partyOf(party: Pick<IncomingParty, "botId" | "name" | "color" | "agent" | "key" | "phone">, bots: readonly Bot[]): Party {
  // #4112: the person's phone line, "Text Message (514 555-0142)", its key
  // drawing the phone glyph in place of a mascot (PartyAvatar)
  if (party.phone) {
    const call = party.phone === "call";
    const lead = t(call ? "chat.incoming.phoneCall" : "chat.incoming.textMessage");
    const name = party.name ? t(call ? "chat.incoming.phoneCallFrom" : "chat.incoming.textMessageFrom", { label: party.name }) : lead;
    // the locale's words after the source ("(555 010-0142)") stay whole on a narrow row
    const detail = name !== lead && name.startsWith(lead) ? name.slice(lead.length).trim() : "";
    return detail ? { id: party.key, name, lead, detail } : { id: party.key, name };
  }
  if (party.agent) return { id: `${AGENT_OPENER_PREFIX}${party.name ?? ""}`, name: party.name ?? t("chat.peer.aiClientName") };
  const bot = party.botId ? bots.find((candidate) => candidate.id === party.botId) : party.name ? bots.find((candidate) => candidate.name === party.name) : undefined;
  return { id: bot?.id ?? party.botId ?? party.key, name: bot?.name ?? party.name ?? t("chat.askLine.aTeammate"), color: bot?.color ?? party.color };
}

/** Stored copies of one party's requests, as the lines of a 1:1 between the
 * asker and this bot, newest first. Nothing is fetched: the copy is all there is. */
function storedExchange(entries: readonly IncomingEntry[], asker: Party, self: Party): Message[] {
  const as = (party: Party) => ({ botId: party.id, name: party.name, color: (party.color ?? "blue") as NonNullable<Message["from"]>["color"] });
  return entries.flatMap((entry) => {
    const at = entry.message.at;
    const lines: Message[] = [];
    if (entry.request) lines.push({ id: `${entry.message.id}:ask`, role: "user", kind: "text", text: entry.request, at, from: as(asker) } as Message);
    // the line's own words for why it left no answer (one wording per state)
    const answer = entry.reply ?? (entry.trace ? sentence(t(`chat.askLine.trace.${entry.trace}` as LocaleKey)) : undefined);
    if (answer) lines.push({ id: `${entry.message.id}:answer`, role: "bot", kind: "text", text: answer, at, from: as(self) } as Message);
    return lines;
  });
}

/** A tail's words as a line of the exchange, with its first letter up. */
function sentence(words: string): string {
  return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}

/** One line of requests that came in, whatever the source row. */
export const IncomingLine = memo(function IncomingLine({ line, self, bots, mid }: {
  line: Pick<IncomingLineItem, "verb" | "entries">;
  self?: Party;
  bots: readonly Bot[];
  mid?: string;
}) {
  "use memo";
  const [open, setOpen] = useState<{ key: string; index: number } | null>(null);
  const parties = incomingParties(line.entries);
  const tail = incomingTail(line.entries, parties.length);
  const me: Party = self ?? { id: "", name: "" };
  const shown: LineParty[] = parties.map((party) => {
    const who = partyOf(party, bots);
    return {
      key: party.key,
      botId: who.id,
      name: who.lead ?? who.name,
      ...(who.detail ? { detail: who.detail } : {}),
      color: who.color,
      onOpen: () => setOpen({ key: party.key, index: 0 }),
      label: t("sendReceipt.open", { name: who.name }),
    };
  });
  const openParty = open ? parties.find((party) => party.key === open.key) : undefined;
  const sheet = (() => {
    if (!openParty || !open) return null;
    const who = partyOf(openParty, bots);
    const close = () => setOpen(null);
    const threaded = openParty.entries.filter((entry) => entry.threadId);
    const stored = openParty.entries.filter((entry) => !entry.threadId);
    // a party with requests in their own threads: one at a time, newest first
    const index = Math.min(open.index, threaded.length + (stored.length ? 1 : 0) - 1);
    const pages = threaded.length + (stored.length ? 1 : 0);
    const footer = pages > 1 ? (
      <>
        <button type="button" className={PILL} data-incoming-newer="" disabled={index === 0} onClick={() => setOpen({ key: openParty.key, index: index - 1 })}>
          {t("chat.incoming.newer")}
        </button>
        <span data-incoming-position="" className="text-[12px] tabular-nums text-ink-tertiary">{t("chat.find.position", { index: index + 1, count: pages })}</span>
        <button type="button" className={PILL} data-incoming-older="" disabled={index >= pages - 1} onClick={() => setOpen({ key: openParty.key, index: index + 1 })}>
          {t("chat.incoming.older")}
        </button>
      </>
    ) : undefined;
    const entry = threaded[index];
    if (entry) {
      // the asker wrote the user-role lines of the exchange, the other answered
      const answer = line.verb === "answerFrom";
      const owner = answer ? me : who;
      const teammate = answer ? who : me;
      return (
        <Suspense fallback={null}>
          <TeammateExchangeSheet
            owner={owner.id ? { id: owner.id, name: owner.name, color: owner.color as never } : undefined}
            teammate={{ id: teammate.id, name: teammate.name, color: teammate.color }}
            threadId={entry.threadId!}
            task={entry.request}
            bots={bots.filter((bot) => bot.id === who.id || bot.id === me.id)}
            footer={footer}
            onClose={close}
          />
        </Suspense>
      );
    }
    return (
      <ExchangeSheet
        run={{ id: `incoming:${openParty.key}`, messages: storedExchange(stored, who, me), party: { id: who.id, name: who.name, color: who.color }, ends: [{ id: who.id, name: who.name, color: who.color }, ...(me.id ? [{ id: me.id, name: me.name, color: me.color }] : [])] }}
        bots={bots}
        showToolCalls={false}
        footer={footer}
        testId="incoming-exchange-sheet"
        onClose={close}
      />
    );
  })();
  const traced = tail && "trace" in tail ? tail.trace : undefined;
  return (
    <NamesLine
      testId="incoming-line"
      verb={t(VERB[line.verb])}
      parties={shown}
      bots={bots}
      tail={!tail ? undefined : "count" in tail ? t(tail.count === 1 ? "chat.incoming.requests.one" : "chat.incoming.requests.other", { count: tail.count }) : t(`chat.askLine.trace.${tail.trace}` as LocaleKey)}
      tailTone={traced === "failed" || traced === "stopped" ? "danger" : undefined}
      mid={mid}
      data={{ "data-incoming": line.verb, ...(traced ? { "data-relay-trace": traced } : {}) }}
    >
      {sheet}
    </NamesLine>
  );
});

export const HandoffRow = memo(function HandoffRow({ message }: { message: Message }) {
  "use memo";
  const { bots, botId } = useChatRows();
  const requestId = handoffRequestId(message);
  const answersId = handoffResultId(message);
  // The open conversation's transcript: the result that answers this
  // receipt, or (for an answer or a request received) the line it makes.
  const owned = useStoreSelector((state) => {
    if (!requestId && !answersId) return undefined;
    const owner = state.bots.find((bot) => bot.id === botId) ?? state.groups.find((group) => group.id === botId);
    return owner?.messages;
  });
  const ref = message.threadRef;
  if (!ref || !message.tool) return null;
  const self = bots.find((bot) => bot.id === botId);
  const lookup = owned ?? [];
  // a request this bot received, or an answer whose receipt is not here
  const entry = incomingEntry(message, botId, lookup);
  if (entry) return <IncomingLine line={{ verb: entry.verb, entries: [entry] }} self={self} bots={bots} mid={message.id} />;
  // an answer drawn in its receipt's line
  if (answersId) return null;
  const result = handoffResultIn(lookup, requestId);
  const ask = askEntry(message, result ? [result] : [], bots);
  return (
    <AskLine
      asks={[ask]}
      self={self}
      bots={bots}
      mid={message.id}
      data={{ "data-handoff": requestId ?? ref.threadId, "data-handoff-side": "request", "data-handoff-phase": ask.state }}
    />
  );
});
