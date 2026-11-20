// What a skill's row does (open, edit, review changes, on and off, share,
// stop sharing, remove) and the pages it opens (the skill, its review
// before it is switched on), in one place for every surface that lists the
// bot's skills: the Skills card (SkillsSection) and the bot page's folder,
// whose skills/<name>/ entries carry the same actions in their "..." menu
// (M-20261119-081). One list of actions (skillActions), never two.
import { useEffect, useState, type ReactNode } from "react";

import { useConfirm } from "@/components/ConfirmProvider";
import { skillsLibraryEnabled } from "@/lib/feature-flags";
import { viewerBotsReadOnly } from "@/lib/viewer";
import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "../BotEditorContext";
import { SkillEditorPage, type SkillEditorTarget } from "../SkillEditorPage";
import type { useManagedSkills } from "../SkillsSection";
import { SkillReviewDialog } from "./reviewDialog";
import { SkillDetailActions, SkillDetails } from "./plainParts";
import { removeSkill } from "./removeSkill";
import type { ManagedSkill, SkillRowActions } from "./types";

type Managed = ReturnType<typeof useManagedSkills>;

export function useSkillRows(bot: Bot, managed: Managed, { plain }: { plain: boolean }): {
  rowActions: SkillRowActions;
  /** the open skill and the review before a skill is switched on */
  overlays: ReactNode;
} {
  const confirm = useConfirm();
  const { request: api } = useBotEditor();
  const { state, dispatch } = useStore();
  const libraryOn = skillsLibraryEnabled(state.config);
  // A read-only person is capped at use, so a skill change is 403.
  const skillWrites = !viewerBotsReadOnly(state.config);
  const { skills, working, setWorking, error, setError, reviewing, setReviewing, refresh, toggle, enableReviewed, share, unshare, assignmentBusy, putAssignments } = managed;
  const [editing, setEditing] = useState<SkillEditorTarget | null>(null);

  useEffect(() => {
    setEditing(null);
  }, [bot.id]);

  const closePanel = () => {
    dispatch({ type: "toggleSettings", open: false });
    dispatch({ type: "toggleComputer", open: false });
  };

  const remove = async (skill: ManagedSkill) => {
    const removed = await removeSkill(
      { botId: bot.id, confirm, api, assignmentBusy, setWorking, setError, putAssignments, unshare, refresh },
      skill,
    );
    if (removed) setEditing((current) => (current?.name === skill.name ? null : current));
  };
  const openSkill = (skill: ManagedSkill, startEditing = false) => {
    setEditing({ name: skill.name, origin: skill.origin, startEditing });
  };
  const reviewSkill = (skill: ManagedSkill) => {
    setEditing({ name: skill.name, origin: skill.origin, startReview: true });
  };

  // The opened skill follows the list: a share or a stop sharing moves it
  // (its origin, so the page reads it from its new place), a remove closes it.
  const editedSkill = editing ? skills.find((skill) => skill.name === editing.name) ?? null : null;
  useEffect(() => {
    if (editing && editedSkill?.origin && editedSkill.origin !== editing.origin) {
      setEditing({ ...editing, origin: editedSkill.origin, startEditing: false, startReview: false });
    }
  }, [editing, editedSkill?.origin]);

  const rowActions: SkillRowActions = { libraryOn, skillWrites, working, openSkill, toggle, share, unshare, remove, reviewSkill };

  const overlays = (
    <>
      {editing && (
        <SkillEditorPage
          botId={bot.id}
          target={editing}
          onClose={() => setEditing(null)}
          onPanelClose={closePanel}
          onSaved={() => void refresh()}
          // #4148: on the profile page the row is compact; what it no longer
          // shows, and its actions, are here.
          details={plain && editedSkill ? <SkillDetails a={rowActions} skill={editedSkill} /> : undefined}
          actions={plain && editedSkill ? <SkillDetailActions a={rowActions} skill={editedSkill} /> : undefined}
        />
      )}

      {/* after the open skill, so Turn on from it shows its review on top */}
      {skillWrites && reviewing && (
        <SkillReviewDialog
          skill={reviewing.skill}
          text={reviewing.text}
          error={error}
          working={working === reviewing.skill.name}
          onCancel={() => setReviewing(null)}
          onEnable={() => void enableReviewed()}
          onPanelClose={closePanel}
        />
      )}
    </>
  );

  return { rowActions, overlays };
}
