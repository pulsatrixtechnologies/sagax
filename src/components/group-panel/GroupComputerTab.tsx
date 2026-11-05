// Group panel > Computer (2026-11-03, JC): a group has no computer of its
// own on the server; each member bot works on its own (the room's shared
// folder, under Members > Advanced, only says where their shell runs). The
// tab shows the computer of one of the viewer's bots in the group, chosen
// in a pill at its top (the lead's by default), with the bot panel's own
// Computer body.
import { useState } from "react";

import type { Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { PillSelect } from "../SettingsPrimitives";
import { ComputerPanel } from "../ComputerPanel";

/** The viewer's bots in the group that work somewhere: the ones with a computer to show. */
export function groupComputerBots(ownBots: readonly Bot[]): Bot[] {
  return ownBots.filter((bot) => bot.computer !== "off");
}

export function GroupComputerTab({ bots, leadBotId, onOpenVmWorkspace }: {
  bots: Bot[];
  leadBotId?: string;
  onOpenVmWorkspace?: (botId: string) => void;
}) {
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const bot = bots.find((candidate) => candidate.id === picked) ?? bots.find((candidate) => candidate.id === leadBotId) ?? bots[0];
  if (!bot) return null;
  return (
    <div data-group-computer={bot.id} className="flex flex-col gap-3 px-4 pt-2">
      {bots.length > 1 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] leading-[18px] text-ink-secondary">{t("groupPanel.computer.of")}</span>
          <PillSelect ariaLabel={t("groupPanel.computer.of")} value={bot.id} onChange={setPicked} options={bots.map((candidate) => ({ value: candidate.id, label: candidate.name }))} />
        </div>
      )}
      <ComputerPanel key={bot.id} bot={bot} onOpenVmWorkspace={onOpenVmWorkspace} embedded />
    </div>
  );
}
