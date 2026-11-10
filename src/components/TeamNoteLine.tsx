// The quiet line in an orchestrator bot's chat when the person wrote to one
// of its team bots in a step's coding chat (#3451 lot 2, #3462): "You wrote
// to [face] <bot>", drawn with NamesLine like "Messaged" and "Asked", no
// bubble, no ring, no unread. The name opens that step's coding chat where
// the chat is. The orchestrator reads the words at its next turn (the row's
// text); no turn is started for it.
import type { Bot } from "@/state/store";
import { useStoreDispatch } from "@/state/store-selector";
import { t } from "@/lib/i18n";
import type { TeamNote } from "@/lib/team-work";
import { NamesLine } from "./BotNamesLine";
import { openTeamStep } from "./bot-settings/ActivitySection";

export function TeamNoteLine({ note, count, orchestratorId, bots, mid }: {
  note: TeamNote;
  /** The writes of the burst this line stands for. */
  count: number;
  /** The bot whose chat this is: the step's work is its own. */
  orchestratorId: string;
  bots: readonly Bot[];
  mid?: string;
}) {
  const dispatch = useStoreDispatch();
  const name = note.botName.trim() || t("teamWork.unnamed");
  return (
    <NamesLine
      testId="team-note-line"
      verb={t("teamWork.note.wrote")}
      parties={[{
        key: note.threadId,
        botId: note.botId,
        name,
        title: note.text,
        label: t("teamWork.note.openAria", { name }),
        data: { "data-team-note-open": note.threadId },
        onOpen: () => openTeamStep(dispatch, orchestratorId, { botId: note.botId, threadId: note.threadId, name: note.title?.trim() || name }),
      }]}
      bots={bots}
      tail={count > 1 ? t("teamWork.note.count", { count }) : undefined}
      mid={mid}
      data={{ "data-team-note": note.threadId }}
    />
  );
}
