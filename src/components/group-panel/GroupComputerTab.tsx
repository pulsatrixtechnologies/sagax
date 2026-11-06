// Group panel > Computer (2026-11-03, JC): a group has no computer of its
// own on the server; each member bot works on its own (the room's shared
// folder, under Members > Advanced, only says where their shell runs). The
// tab shows the computer of one of the viewer's bots in the group, chosen
// in a pill at its top (the lead's by default). 2026-11-06 (JC): the body is
// the bot panel's own Computer card (Activity > Computer, ComputerCard), in
// the bot panel's padding, so the two read the same: its row opens the live
// desktop, its right-click menu changes where the bot works.
// 2026-11-06 (JC, later): no Computer tab. The card is a section of Details,
// where the bot panel draws it (after Suggested): GroupComputerSection.
import { useState } from "react";

import { useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { canEditBotField } from "@/lib/bot-capabilities";
import { PillSelect } from "../SettingsPrimitives";
import { ComputerCard } from "../bot-settings/ComputerCard";

/** The viewer's bots in the group that work somewhere: the ones with a computer to show. */
export function groupComputerBots(ownBots: readonly Bot[]): Bot[] {
  return ownBots.filter((bot) => bot.computer !== "off");
}

/** Details > Computer: the bot panel's Computer section for one of the
 * viewer's bots in the group (the lead's by default). With several, a pill
 * on the section's label row picks whose computer shows. */
export function GroupComputerSection({ bots, leadBotId }: {
  bots: Bot[];
  leadBotId?: string;
}) {
  const { state, dispatch } = useStore();
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const bot = bots.find((candidate) => candidate.id === picked) ?? bots.find((candidate) => candidate.id === leadBotId) ?? bots[0];
  if (!bot) return null;
  return (
    <div data-group-computer={bot.id} className="relative">
      <ComputerCard
        key={bot.id}
        bot={bot}
        onPatch={(patch) => dispatch({ type: "updateBot", botId: bot.id, patch })}
        readOnly={!canEditBotField(state.config, bot, "computer")}
      />
      {bots.length > 1 && (
        <div className="absolute right-0 top-0 flex h-[18px] items-center">
          <PillSelect ariaLabel={t("groupPanel.computer.of")} value={bot.id} onChange={setPicked} options={bots.map((candidate) => ({ value: candidate.id, label: candidate.name }))} />
        </div>
      )}
    </div>
  );
}

export function GroupComputerTab({ bots, leadBotId }: {
  bots: Bot[];
  leadBotId?: string;
}) {
  const { state, dispatch } = useStore();
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const bot = bots.find((candidate) => candidate.id === picked) ?? bots.find((candidate) => candidate.id === leadBotId) ?? bots[0];
  if (!bot) return null;
  return (
    <div data-group-computer={bot.id} data-panel-bot="" className="flex flex-col gap-5 px-4 pb-6 pt-2">
      {bots.length > 1 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] leading-[18px] text-ink-secondary">{t("groupPanel.computer.of")}</span>
          <PillSelect ariaLabel={t("groupPanel.computer.of")} value={bot.id} onChange={setPicked} options={bots.map((candidate) => ({ value: candidate.id, label: candidate.name }))} />
        </div>
      )}
      <ComputerCard
        key={bot.id}
        bot={bot}
        onPatch={(patch) => dispatch({ type: "updateBot", botId: bot.id, patch })}
        readOnly={!canEditBotField(state.config, bot, "computer")}
      />
    </div>
  );
}
