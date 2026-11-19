// The structured facts of a bot's question (ask_choice `facts`): a compact
// two-column table, a quiet label on the left and its value on the right,
// above the card's sentence. A long value (a ticket's request) wraps; a value
// that carries a record (a ticket number) stays the clickable record chip.
// Only drawn for facts the bot sent as such: no other text becomes a table.
import { RecordLink } from "@/components/RecordLink";
import { cn } from "@/lib/cn";
import type { AskFact } from "../../shared/ask-question";

export function AskFactsTable({ facts, className }: { facts: readonly AskFact[] | undefined; className?: string }) {
  if (!facts?.length) return null;
  return (
    <dl
      data-ask-facts=""
      className={cn("mb-2 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-[13px] leading-[18px]", className)}
    >
      {facts.map((fact, index) => (
        <div key={`${index}-${fact.label}`} className="contents">
          <dt dir="auto" className="max-w-[9rem] break-words text-[12px] leading-[18px] text-ink-tertiary" title={fact.label}>{fact.label}</dt>
          <dd dir="auto" className="m-0 min-w-0 break-words text-ink">
            {fact.record ? <RecordLink record={fact.record}>{fact.value}</RecordLink> : fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
