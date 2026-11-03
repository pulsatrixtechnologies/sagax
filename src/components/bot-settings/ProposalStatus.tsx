// Quiet boundary marker (a lock with its sentence as the tooltip) for the bot settings dialog: which field groups never
// leave the owner's hands. Copy only, nothing here adds agent reach, and the
// marker disappears when no other Chief covers the bot's section (nobody could
// propose) or in the new-bot draft editor (the bot does not exist yet).
import { Lock } from "lucide-react";
import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./BotEditorContext";

const sectionKey = (section?: string | null) => (section ?? "").trim();

/** A Chief covers this bot when it holds the role in the bot's section or
 * has the bot's section among its owner-approved managed sections: the
 * same reach server/peers/peer-roster.ts grants a Chief for proposals. */
function chiefCovers(bot: Bot, bots: ReadonlyArray<Bot>): boolean {
  const target = sectionKey(bot.section);
  return bots.some((candidate) =>
    candidate.id !== bot.id &&
    Boolean(candidate.chiefOfStaff) &&
    (sectionKey(candidate.section) === target ||
      (Array.isArray(candidate.managedSections) &&
        candidate.managedSections.some((team) => typeof team === "string" && sectionKey(team) === target))));
}

export function ProposalStatus({ bot }: { bot: Bot }) {
  const { draft } = useBotEditor();
  const { state } = useStore();
  if (draft || !chiefCovers(bot, state.bots)) return null;
  // A small lock after the section title; the sentence is its tooltip.
  return (
    <span role="img" data-proposal-owner="" aria-label={t("botSettings.proposal.owner")} title={t("botSettings.proposal.owner")} className="ml-1.5 inline-flex align-[-1px] text-ink-tertiary">
      <Lock size={11} aria-hidden="true" />
    </span>
  );
}
