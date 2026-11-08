// #2901 (2026-11-08, « rien d'invisible »): a line or card copied into the
// bot's chat from a background conversation (MCP send_prompt, routine run,
// proactive wake, teammate work) carries a discreet provenance label, in the
// same style as the parallel task's result line.
import { BellRing, Plug, Repeat, Users } from "lucide-react";
import type { Message } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

const ICON = { mcp: Plug, routine: Repeat, proactive: BellRing, teammate: Users } as const;

export function RelayViaLabel({ message }: { message: Pick<Message, "relayVia"> }) {
  const via = message.relayVia;
  if (!via || !(via in ICON)) return null;
  const Icon = ICON[via];
  const name = t(`chat.relayVia.${via}` as LocaleKey);
  return (
    <div className="mb-1 flex items-center gap-1.5 pl-0.5 text-[11px] text-ink-secondary" data-relay-via={via} title={t("chat.relayVia.label", { via: name })}>
      <Icon size={11} aria-hidden="true" />
      <span>{name}</span>
    </div>
  );
}
