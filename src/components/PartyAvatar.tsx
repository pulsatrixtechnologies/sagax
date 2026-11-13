// One end of a bot-to-bot exchange: the bot's own mascot, or a neutral icon
// for a party with no mascot of its own: an outside agent (a person's AI
// client over MCP, `agent:` ids, shared/agent-conversation.ts) or the
// person's phone line (#4112, `phone:sms:` and `phone:call:` ids,
// lib/incoming-line).
import type { ReactNode } from "react";
import { Cpu, Phone, Smartphone } from "lucide-react";
import { AGENT_OPENER_PREFIX } from "../../shared/agent-conversation";
import { PHONE_PARTY_PREFIX } from "@/lib/incoming-line";
import type { MausColor } from "@/lib/mascot";
import type { Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";

/** Whether an exchange party is an outside agent, not a bot. */
export function isAgentParty(id: string | undefined): boolean {
  return typeof id === "string" && id.startsWith(AGENT_OPENER_PREFIX);
}

/** How a phone-line party came in, or null for any other id. */
function phonePartyVia(id: string | undefined): "sms" | "call" | null {
  if (typeof id !== "string" || !id.startsWith(PHONE_PARTY_PREFIX)) return null;
  return id.startsWith(`${PHONE_PARTY_PREFIX}call:`) ? "call" : "sms";
}

export function PartyAvatar({ id, bot, size }: { id?: string; bot: { name: string; color: MausColor } & Partial<Bot>; size: number }) {
  if (isNeutralParty(id)) return <NeutralPartyIcon id={id} size={size} />;
  return <BotAvatar bot={bot as Bot} state="happy" size={size} animated={false} />;
}

/** Whether a party has no mascot of its own and draws a neutral icon. */
export function isNeutralParty(id: string | undefined): boolean {
  return isAgentParty(id) || phonePartyVia(id) !== null;
}

/** The neutral icon of a party with no mascot, or null for a bot. */
export function NeutralPartyIcon({ id, size }: { id: string | undefined; size: number }) {
  const phone = phonePartyVia(id);
  if (phone) return <NeutralIcon size={size} data={{ "data-phone-avatar": phone }}>{phone === "call" ? <Phone size={Math.round(size * 0.62)} strokeWidth={2} /> : <Smartphone size={Math.round(size * 0.62)} strokeWidth={2} />}</NeutralIcon>;
  if (isAgentParty(id)) return <AgentIcon size={size} />;
  return null;
}

/** The neutral icon of an outside agent. */
export function AgentIcon({ size }: { size: number }) {
  return <NeutralIcon size={size} data={{ "data-agent-avatar": "" }}><Cpu size={Math.round(size * 0.62)} strokeWidth={2} /></NeutralIcon>;
}

function NeutralIcon({ size, data, children }: { size: number; data: Record<string, string>; children: ReactNode }) {
  return (
    <span
      {...data}
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary"
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  );
}
