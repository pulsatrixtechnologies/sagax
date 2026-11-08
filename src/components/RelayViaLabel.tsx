// #2901 (2026-11-08, « rien d'invisible »): a line or card copied into the
// bot's chat from a background conversation (MCP send_prompt, routine run,
// proactive wake, teammate work) carries a discreet provenance label, in the
// same style as the parallel task's result line.
//
// #2915: the label also says what was asked and by whom (the full request in
// its tooltip), and a background turn that left nothing to copy (failed,
// stopped, no reply) is one discreet trace line under it.
import { BellRing, Plug, Repeat, Users } from "lucide-react";
import type { Message } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

const ICON = { mcp: Plug, routine: Repeat, proactive: BellRing, teammate: Users } as const;

export function RelayViaLabel({ message }: { message: Pick<Message, "relayVia" | "relayAsk"> }) {
  const via = message.relayVia;
  if (!via || !(via in ICON)) return null;
  const Icon = ICON[via];
  const name = t(`chat.relayVia.${via}` as LocaleKey);
  const ask = message.relayAsk?.text?.trim();
  const by = message.relayAsk?.by?.trim();
  return (
    <div className="mb-1 flex min-w-0 max-w-full items-center gap-1.5 pl-0.5 text-[11px] text-ink-secondary" data-relay-via={via} title={t("chat.relayVia.label", { via: name })}>
      <Icon size={11} aria-hidden="true" className="shrink-0" />
      <span className="shrink-0">{by ? t("chat.relayVia.by", { via: name, by }) : name}</span>
      {ask && <span className="min-w-0 truncate" data-relay-ask title={ask}>{t("chat.relayVia.ask", { ask })}</span>}
    </div>
  );
}

/** #2915: a background turn that ended with nothing to copy. */
export function RelayTraceLine({ message }: { message: Pick<Message, "relayTrace" | "text"> }) {
  const trace = message.relayTrace;
  if (!trace) return null;
  const known = trace === "failed" || trace === "stopped" || trace === "silent";
  return (
    <div className="pl-0.5 text-[12px] italic text-ink-secondary" data-relay-trace={trace}>
      {known ? t(`chat.relayVia.trace.${trace}` as LocaleKey) : message.text}
    </div>
  );
}
