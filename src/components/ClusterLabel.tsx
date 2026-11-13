// The author of a run of lines in a conversation with several bots: the
// bot's mascot (16px) and its name in its colour, once per run. A room
// (GroupView) and an open bot-to-bot conversation (BotExchangeChip) draw it.
import type { Bot } from "@/state/store";
import { normalizeState } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { BotAvatar } from "./Avatar";
import { NeutralPartyIcon, isNeutralParty } from "./PartyAvatar";

/** `end`: the run sits on the end side (an answering bot in a bot-to-bot
 * conversation, where the person's lines go in a 1:1), so its label does too.
 * `partyId`: a party with no mascot (an outside agent, the person's phone
 * line, PartyAvatar) is drawn with its neutral icon instead. */
export function ClusterLabel({ bot, name, color, end = false, partyId }: { bot?: Bot; name: string; color: string; end?: boolean; partyId?: string }) {
  "use memo";
  const botColor = (bot?.color ?? color) as Bot["color"];
  return (
    <div className={cn("-mb-1.5 mt-3 flex items-center gap-1.5 px-1.5", end ? "me-1.5 justify-end" : "ms-1.5")}>
      {isNeutralParty(partyId) ? <NeutralPartyIcon id={partyId} size={16} /> : (
        <BotAvatar
          bot={bot ?? { name, color: botColor }}
          state={normalizeState(bot?.mascotExpression) ?? "happy"}
          size={16}
          motion="none"
          motionKey={0}
          animated={false}
        />
      )}
      <span className="text-[12px] font-normal leading-4 bot-identity" data-bot-color={botColor}>{name}</span>
    </div>
  );
}
