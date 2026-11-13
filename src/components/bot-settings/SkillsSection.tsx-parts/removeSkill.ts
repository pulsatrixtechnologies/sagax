import type { useConfirm } from "@/components/ConfirmProvider";
import { t } from "@/lib/i18n";
import type { useBotEditor } from "../BotEditorContext";
import type { ManagedSkill } from "./types";

export interface RemoveSkillEnv {
  botId: string;
  confirm: ReturnType<typeof useConfirm>;
  api: ReturnType<typeof useBotEditor>["request"];
  assignmentBusy: { current: boolean };
  setWorking: (name: string) => void;
  setError: (message: string) => void;
  putAssignments: (name: string, remove: boolean) => Promise<unknown>;
  unshare: (skill: ManagedSkill) => unknown;
  refresh: () => Promise<unknown>;
}

/** True once the skill is gone from this bot (a stop sharing keeps this
 * bot's own copy, so it is not). */
export async function removeSkill(env: RemoveSkillEnv, skill: ManagedSkill): Promise<boolean> {
  const { confirm, api, assignmentBusy, setWorking, setError, putAssignments, unshare, refresh } = env;
  if (skill.origin === "library") {
    if (assignmentBusy.current) return false;
    if (!(await confirm({
      title: t("botPanel.skills.unassignConfirm", { name: skill.name }),
      confirmLabel: t("botPanel.skills.removeTitle"),
      tone: "danger",
    }))) return false;
    assignmentBusy.current = true;
    setWorking(skill.name);
    setError("");
    try {
      await putAssignments(skill.name, true);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botPanel.skills.unassignError"));
      return false;
    } finally {
      assignmentBusy.current = false;
      setWorking("");
    }
  }
  if (skill.origin === "me") {
    await unshare(skill);
    return false;
  }
  if (!(await confirm({
    title: t("botPanel.skills.removeLearnedConfirm", { name: skill.name }),
    confirmLabel: t("botPanel.skills.removeTitle"),
    tone: "danger",
  }))) return false;
  setWorking(skill.name);
  setError("");
  try {
    await api(`/api/bots/${env.botId}/skills/${encodeURIComponent(skill.name)}`, { method: "DELETE" });
    await refresh();
    return true;
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : t("botPanel.skills.removeError"));
    return false;
  } finally {
    setWorking("");
  }
}
