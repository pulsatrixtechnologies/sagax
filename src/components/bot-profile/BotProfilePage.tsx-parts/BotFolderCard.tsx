// Knowledge on the bot page (M-20261119-081): To review, then the Bot folder
// in place (the owner: the Skills, Write a command and Its work sections are
// gone, the folder takes their place). Nothing those sections offered is
// lost; each function moved into a "..." menu of the folder or of its entry,
// with no new section:
//
// - the folder's "...": Skills (the whole Skills card in a modal: every skill,
//   the shared ones too, + Add from the library, a file, a link or the
//   organization), Learn from use, Write a command, the Memory page, then
//   the memory's Upkeep and changes;
// - a skill's own folder, skills/<name>/: its state under its name (Needs
//   review, Off, what it does, who it is shared with) and its actions in its
//   "..." (Open, Review changes, Edit, Turn on or off, Share with my bots,
//   Stop sharing, Remove), the very list the Skills card's rows use;
// - skills/ itself: what needs review under its name, and Skills in its "...".
//
// The skills are read once here (useManagedSkills) for To review and the
// folder; the Skills modal reads its own and this card reads again when it
// closes (refreshKey).
import { useEffect, useRef } from "react";
import { BookOpen, Brain, GraduationCap, SquareSlash } from "lucide-react";

import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { skillAuthoringEnabled } from "@/lib/feature-flags";
import { viewerBotsReadOnly } from "@/lib/viewer";
import { useStore, type Bot, type BotSettingsSection } from "@/state/store";
import { useManagedSkills } from "../../bot-settings/SkillsSection";
import { useSkillRows } from "../../bot-settings/SkillsSection.tsx-parts/useSkillRows";
import { skillActions } from "../../bot-settings/SkillsSection.tsx-parts/actions";
import { sharedLabel, skillNeedsPerson, skillStateLine } from "../../bot-settings/SkillsSection.tsx-parts/plainParts";
import type { ManagedSkill } from "../../bot-settings/SkillsSection.tsx-parts/types";
import { WorkspaceFilesSection, type WorkspaceEntryExtras, type WorkspaceMenuItem } from "../../bot-settings/WorkspaceFilesSection";
import { FolderMenu } from "../../bot-settings/WorkspaceFilesSection.tsx-parts/menus";
import { Note, ProfileCard, sectionLabel } from "./cards";
import { ReviewCard, type ReviewEntry } from "./ReviewCard";

/** The skill a folder of skills/ holds, by its name (skills/<name>). */
export function skillOfEntry(path: string, skills: readonly ManagedSkill[]): ManagedSkill | null {
  const match = /^skills\/([^/]+)$/.exec(path);
  return match ? skills.find((skill) => skill.name === match[1]) ?? null : null;
}

export function BotFolderCard({ bot, active, lock, memoryEditable, memory, skillsShown, refreshKey, onOpenSection, onOpenChat, onOpenSkills, onWriteCommand, onOpenMemory }: {
  bot: Bot;
  /** the Knowledge tab is on screen: the folder reads its list */
  active: boolean;
  /** why this viewer may not change the folder, or null */
  lock: LocaleKey | null;
  memoryEditable: boolean;
  memory: { enabled: boolean; busy: boolean; onToggle: (enabled: boolean) => void } | undefined;
  /** this viewer gets the skills (Simple mode hides them) */
  skillsShown: boolean;
  /** changes when the Skills modal closes: the skills are read again */
  refreshKey: number;
  onOpenSection: (target: BotSettingsSection) => void;
  /** To review's "Open in chat" */
  onOpenChat: (entry: ReviewEntry) => void;
  onOpenSkills: () => void;
  onWriteCommand: () => void;
  onOpenMemory: () => void;
}) {
  const { state, dispatch } = useStore();
  const managed = useManagedSkills(bot);
  const { skills, staged, loading, deciding, decideError, decideStaged, refresh } = managed;
  const { rowActions, overlays } = useSkillRows(bot, managed, { plain: true });
  const skillWrites = !viewerBotsReadOnly(state.config);
  const learningOffered = skillAuthoringEnabled(state.config);
  const learningOn = bot.skillLearning !== false;

  const readKey = useRef(refreshKey);
  useEffect(() => {
    if (readKey.current === refreshKey) return;
    readKey.current = refreshKey;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const openSkills: WorkspaceMenuItem = { id: "skills", icon: <BookOpen size={14} />, label: t("botSettings.nav.skills"), run: onOpenSkills };
  const folderMenu: WorkspaceMenuItem[] = [
    ...(skillsShown ? [
      openSkills,
      // Learn from use (#2610): the bot's own switch, on unless turned off; a person who may not change it reads its state
      ...(learningOffered ? [{
        id: "learning", icon: <GraduationCap size={14} />, label: t("botPanel.skills.learning"), checked: learningOn, disabled: !skillWrites,
        run: () => dispatch({ type: "updateBot", botId: bot.id, patch: { skillLearning: !learningOn } }),
      }] : []),
      ...(skillWrites ? [{ id: "command", icon: <SquareSlash size={14} />, label: t("skills.write.title"), run: onWriteCommand }] : []),
    ] : []),
    { id: "memory", icon: <Brain size={14} />, label: t("botProfile.memoryPage"), divider: true, run: onOpenMemory },
  ];

  const waiting = skills.filter(skillNeedsPerson).length;
  const entryExtras = (entry: { path: string; kind: "file" | "dir" }): WorkspaceEntryExtras | null => {
    if (!skillsShown || entry.kind !== "dir") return null;
    if (entry.path === "skills") {
      return {
        menu: [openSkills],
        ...(waiting > 0 ? { note: <span className="text-warning" data-skills-waiting={String(waiting)}>{t("botProfile.folder.skillsWaiting", { count: waiting })}</span> } : {}),
      };
    }
    const skill = skillOfEntry(entry.path, skills);
    if (!skill) return null;
    const shared = sharedLabel(rowActions, skill);
    return {
      menu: skillActions(rowActions, skill).map((item) => ({ id: `skill-${item.id}`, icon: item.icon, label: item.label, disabled: item.disabled, run: item.run })),
      note: <span data-skill-entry={skill.name}>{skillStateLine(skill)}{shared ? <> · {shared}</> : null}</span>,
      muted: !skill.enabled && skill.origin !== "native",
    };
  };

  return (
    <>
      {skillsShown && (
        <ReviewCard
          staged={staged}
          loading={loading}
          canDecide={skillWrites}
          working={deciding}
          error={decideError}
          onDecide={(entry, behavior) => void decideStaged(entry, behavior)}
          onOpenChat={onOpenChat}
        />
      )}
      {lock ? (
        // A folder this viewer may not change: the reason as a row of its card, its "..." menu still at the label's right
        <ProfileCard
          title={sectionLabel("files")}
          groupId="bot-profile-locked-files"
          accessory={<FolderMenu items={folderMenu} buttonClass="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-hover hover:text-ink" />}
        >
          <Note>{t(lock)}</Note>
        </ProfileCard>
      ) : (
        <WorkspaceFilesSection
          bot={bot}
          active={active}
          memoryEditable={memoryEditable}
          memory={memory}
          onOpenSection={onOpenSection}
          folderMenu={folderMenu}
          entryExtras={entryExtras}
        />
      )}
      {skillsShown && overlays}
    </>
  );
}
