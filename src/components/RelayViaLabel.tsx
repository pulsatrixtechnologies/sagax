// #2901 (2026-11-08, « rien d'invisible »): a line or card copied into the
// bot's chat from a background conversation carries a discreet provenance
// label: where it came from (a routine, a proactive wake).
//
// #3581: a request from a teammate or from an AI client is the one quiet
// names line every trace between bots uses ("Asked by [face] Bot B",
// HandoffRow's IncomingLine), never the quoted request: the request opens
// from the name. A copy stored as a bubble folds into that line in the list
// (lib/incoming-line); a waiting card that came from such a request keeps its
// card, with the same line above it. A routine's or a wake's label says where
// it came from and, when its turn left nothing to copy, why, on that one line.
import { BellRing, Plug, Repeat, Users } from "lucide-react";
import type { Bot, Message } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { relayAskEntry } from "@/lib/incoming-line";
import { IncomingLine } from "./HandoffRow";

const ICON = { mcp: Plug, routine: Repeat, proactive: BellRing, teammate: Users } as const;
const TRACES = new Set<string>(["failed", "stopped", "silent"]);

export function RelayViaLabel({ message }: { message: Pick<Message, "relayVia" | "relayAsk" | "relayTrace"> }) {
  const via = message.relayVia;
  if (!via || !(via in ICON)) return null;
  const Icon = ICON[via];
  const name = t(`chat.relayVia.${via}` as LocaleKey);
  const by = message.relayAsk?.by?.trim();
  const trace = message.relayTrace && TRACES.has(message.relayTrace) ? message.relayTrace : undefined;
  return (
    <div className="mb-1 flex min-w-0 max-w-full items-center gap-1.5 pl-0.5 text-[11px] text-ink-secondary" data-relay-via={via} data-relay-trace={trace} title={t("chat.relayVia.label", { via: name })}>
      <Icon size={11} aria-hidden="true" className="shrink-0" />
      <span className="shrink-0">{by ? t("chat.relayVia.by", { via: name, by }) : name}</span>
      {trace && <span className="min-w-0 truncate">· {t(`chat.askLine.trace.${trace}` as LocaleKey)}</span>}
    </div>
  );
}

/** The provenance of a relayed row: a request of a teammate or of an AI
 * client as its names line, a routine's or a wake's as its label. */
export function RelayProvenance({ message, bots, self }: { message: Message; bots: readonly Bot[]; self?: Pick<Bot, "id" | "name" | "color"> }) {
  const asked = relayAskEntry(message);
  if (!asked) return <RelayViaLabel message={message} />;
  return <IncomingLine line={{ verb: "askedBy", entries: [asked] }} self={self} bots={bots} mid={message.id} />;
}
