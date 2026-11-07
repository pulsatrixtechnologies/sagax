// Skills: durable behavior the bot learned or imported, so the user needs a
// normal way to inspect, disable, and remove it after the one-time approval
// card is gone. Moved from SettingsPanel.tsx's LearnedSkillsCard (79-295),
// its nested review dialog raised from z-[80] to z-[90] to float above this
// dialog's own z-50, plus: an Import from GitHub row, a static "when it's
// used" line on every row (learned skills have no triggers to show), and a
// click-through skill editor (MarkdownEditor, same as MEMORY.md / RULES.md).
import { useConfirm } from "@/components/ConfirmProvider";
import { t } from "@/lib/i18n";
import { skillImportLines } from "@/lib/skill-import";
import type { SkillImportSummary } from "../../../shared/skill-import";
import { useEffect, useRef, useState } from "react";

import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./BotEditorContext";
import { skillAuthoringEnabled, skillsLibraryEnabled } from "@/lib/feature-flags";
import { viewerBotsReadOnly } from "@/lib/viewer";
import { PILL, PLAIN_CARD, PLAIN_FIELD, PRIMARY_PILL, SwitchRow, useSettingsSurface } from "../SettingsPrimitives";
import { cn } from "@/lib/cn";
import { PaneEmpty, PaneSection } from "./PaneSection";
import { OrgSkillsCard } from "./OrgSkillsCard";
import { SkillUpload } from "./SkillUpload";
import { WriteCommandCard } from "./WriteCommandCard";
import { PanelPage } from "./PanelPage";
import type { ManagedSkill, SkillRowActions } from "./SkillsSection.tsx-parts/types";
import { removeSkill } from "./SkillsSection.tsx-parts/removeSkill";
import { renderPlainAddAction, renderPlainSkillRow } from "./SkillsSection.tsx-parts/plainParts";
import { renderClassicSkillRow, renderClassicTop } from "./SkillsSection.tsx-parts/classicParts";
import { SkillEditorPage, type SkillEditorTarget } from "./SkillEditorPage";

export type { ManagedSkill };
/** Library entries this bot has not been assigned yet (flag on only). */
interface LibraryPoolSkill {
  name: string;
  description: string;
}

interface StagedSkillSummary {
  id: string;
  name: string;
  gist: string;
}

/** The bot's installed skills and the on/off switch the Skills section and
 * the Simple bot panel share: switching a skill off writes at once; switching
 * one on fetches its integrity-checked text and waits for an explicit review
 * (`reviewing` + `enableReviewed`) before it can reach the bot's prompt. */
export function useManagedSkills(bot: Bot) {
  const confirm = useConfirm();
  const { request: api } = useBotEditor();
  const [skills, setSkills] = useState<ManagedSkill[]>([]);
  const [assignedSkills, setAssignedSkills] = useState<string[]>([]);
  const [libraryPool, setLibraryPool] = useState<LibraryPoolSkill[]>([]);
  const [addFromLibrary, setAddFromLibrary] = useState("");
  const [staged, setStaged] = useState<StagedSkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState<{ skill: ManagedSkill; text: string } | null>(null);
  // One assignment change at a time: each one reads the server's list first.
  const assignmentBusy = useRef(false);

  const refresh = async (cancelled?: () => boolean) => {
    try {
      const result = (await api(`/api/bots/${bot.id}/skills`)) as {
        skills?: ManagedSkill[];
        staged?: StagedSkillSummary[];
        library?: LibraryPoolSkill[];
        assignedSkills?: string[];
      };
      if (cancelled?.()) return;
      setSkills(result.skills ?? []);
      setStaged(result.staged ?? []);
      setLibraryPool(result.library ?? []);
      setAssignedSkills(result.assignedSkills ?? []);
      setAddFromLibrary("");
      setError("");
    } catch (cause) {
      if (!cancelled?.()) setError(cause instanceof Error ? cause.message : t("botPanel.skills.loadError"));
    } finally {
      if (!cancelled?.()) setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setReviewing(null);
    void refresh(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [bot.id]);

  const putAssignments = async (name: string, remove = false) => {
    const listing = (await api(`/api/bots/${bot.id}/skills`)) as { assignedSkills?: string[] };
    const current = listing.assignedSkills ?? assignedSkills;
    const next = remove ? current.filter((skill) => skill !== name) : [...new Set([...current, name])];
    await api(`/api/bots/${bot.id}/skills-library`, {
      method: "PUT",
      body: JSON.stringify({ skills: next }),
    });
    await refresh();
  };

  const addToBot = async () => {
    const name = addFromLibrary.trim();
    if (!name || assignmentBusy.current) return;
    assignmentBusy.current = true;
    setWorking(name);
    setError("");
    try {
      await putAssignments(name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botPanel.skills.assignError"));
    } finally {
      assignmentBusy.current = false;
      setWorking("");
    }
  };

  const skillTextPath = (skill: ManagedSkill) => {
    if (skill.origin === "library") return `/api/skills-library/${encodeURIComponent(skill.name)}`;
    if (skill.origin === "me") return `/api/me/skills-library/${encodeURIComponent(skill.name)}`;
    return `/api/bots/${bot.id}/skills/${encodeURIComponent(skill.name)}`;
  };

  const toggle = async (skill: ManagedSkill) => {
    setWorking(skill.name);
    setError("");
    try {
      if ((skill.origin === "library" || skill.origin === "me") && skill.enabled) {
        // Shared skills share one review state across every bot that links
        // to them; disabling is immediate, enabling still requires review.
        await api(skillTextPath(skill), {
          method: "PATCH",
          body: JSON.stringify({ enabled: !skill.enabled }),
        });
        await refresh();
        return;
      }
      if (!skill.enabled) {
        // A disabled import has not necessarily been reviewed. Fetch the
        // integrity-checked bytes and require one explicit review step before
        // they can reach the bot's prompt or native skill discovery.
        const result = (await api(skillTextPath(skill))) as { text?: string };
        if (!result.text) throw new Error(t("botPanel.skills.unavailable"));
        setReviewing({ skill, text: result.text });
        return;
      }
      await api(`/api/bots/${bot.id}/skills/${encodeURIComponent(skill.name)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botPanel.skills.updateError"));
    } finally {
      setWorking("");
    }
  };

  const enableReviewed = async () => {
    if (!reviewing) return;
    const { skill } = reviewing;
    setWorking(skill.name);
    setError("");
    try {
      await api(skillTextPath(skill), {
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      });
      setReviewing(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botPanel.skills.enableError"));
    } finally {
      setWorking("");
    }
  };

  const share = async (skill: ManagedSkill, scope: "me" | "organization") => {
    if (assignmentBusy.current) return;
    assignmentBusy.current = true;
    setWorking(skill.name);
    setError("");
    try {
      await api(`/api/bots/${bot.id}/skills/${encodeURIComponent(skill.name)}/share`, {
        method: "POST",
        body: JSON.stringify({ scope }),
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botPanel.skills.shareError"));
    } finally {
      assignmentBusy.current = false;
      setWorking("");
    }
  };

  const unshare = async (skill: ManagedSkill) => {
    if (assignmentBusy.current || (skill.origin !== "me" && skill.origin !== "library")) return;
    if (!(await confirm({
      title: t("botPanel.skills.unshareConfirm", { name: skill.name }),
      confirmLabel: t("botPanel.skills.unshare"),
      tone: "danger",
    }))) return;
    assignmentBusy.current = true;
    setWorking(skill.name);
    setError("");
    try {
      await api(`/api/bots/${bot.id}/skills/${encodeURIComponent(skill.name)}/unshare`, {
        method: "POST",
        body: JSON.stringify({ scope: skill.origin === "me" ? "me" : "organization" }),
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botPanel.skills.unshareError"));
    } finally {
      assignmentBusy.current = false;
      setWorking("");
    }
  };

  return {
    skills, staged, loading, working, setWorking, error, setError, reviewing, setReviewing, refresh, toggle, enableReviewed,
    share, unshare,
    // the shared skills library (features.skillsLibrary): what this bot can still add, and assignment changes
    libraryPool, addFromLibrary, setAddFromLibrary, assignmentBusy, putAssignments, addToBot,
  };
}

/** The review step before a skill is switched on: full SKILL.md as a pushed
 * page in the bot panel. Escape goes back. */
export function SkillReviewDialog({
  skill,
  text,
  error,
  working,
  onCancel,
  onEnable,
  onPanelClose,
}: {
  skill: ManagedSkill;
  text: string;
  error: string;
  working: boolean;
  onCancel: () => void;
  onEnable: () => void;
  onPanelClose?: () => void;
}) {
  return (
    <PanelPage
      name={t("botPanel.skills.reviewTitle", { name: skill.name })}
      onBack={() => { if (!working) onCancel(); }}
      onClose={onPanelClose ?? (() => { if (!working) onCancel(); })}
      data-skill-review-page=""
      bodyClassName="flex flex-col px-4 py-4"
      footer={
        <>
          <span className="flex-1" />
          <button type="button" disabled={working} onClick={onCancel} className={PILL}>
            {t("common.cancel")}
          </button>
          <button type="button" disabled={working} onClick={onEnable} className={PRIMARY_PILL}>
            {t("botPanel.skills.enableReviewed")}
          </button>
        </>
      }
    >
      <div className="break-all text-[12px] text-ink-secondary">
        {t("botPanel.skills.source", { source: skill.source })}
      </div>
      {skill.warnings.length > 0 && (
        <div className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-[12px] text-warning">
          {skill.warnings.join(" · ")}
        </div>
      )}
      <pre
        tabIndex={0}
        aria-label={t("botPanel.skills.fullText", { name: skill.name })}
        className="mt-3 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-inset p-3 font-mono text-[12px] leading-relaxed text-ink"
      >
        {text}
      </pre>
      {error && <div role="alert" className="mt-2 text-[12px] text-danger">{error}</div>}
    </PanelPage>
  );
}

export function SkillsSection({ bot }: { bot: Bot }) {
  const confirm = useConfirm();
  const { request: api } = useBotEditor();
  const { state, dispatch } = useStore();
  const featureEnabled = skillAuthoringEnabled(state.config);
  const libraryOn = skillsLibraryEnabled(state.config);
  // A read-only person is capped at use, so a skill change is 403. The list
  // stays. Team or section manage is not on the viewer, so those writes stay
  // visible and the server still refuses a person who lacks them.
  const skillWrites = !viewerBotsReadOnly(state.config);
  const {
    skills, staged, loading, working, setWorking, error, setError, reviewing, setReviewing, refresh, toggle, enableReviewed,
    share, unshare,
    libraryPool, addFromLibrary, setAddFromLibrary, assignmentBusy, putAssignments, addToBot,
  } = useManagedSkills(bot);
  const [editing, setEditing] = useState<SkillEditorTarget | null>(null);
  const [source, setSource] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const plain = useSettingsSurface() === "plain";
  const closePanel = () => {
    dispatch({ type: "toggleSettings", open: false });
    dispatch({ type: "toggleComputer", open: false });
  };

  useEffect(() => {
    setEditing(null);
  }, [bot.id]);

  // Learn from use (#2610): the bot revises a skill after a failure or a
  // correction and proposes a new one after a long task. The bot's own switch,
  // on unless turned off; shown only while bots may write skills at all.
  const learning = featureEnabled ? (
    <SwitchRow
      label={t("botPanel.skills.learning")}
      help={t("botPanel.skills.learningHelp")}
      checked={bot.skillLearning !== false}
      disabled={!skillWrites}
      onChange={(skillLearning) => dispatch({ type: "updateBot", botId: bot.id, patch: { skillLearning } })}
    />
  ) : null;

  const remove = (skill: ManagedSkill) => removeSkill(
    { botId: bot.id, confirm, api, assignmentBusy, setWorking, setError, putAssignments, unshare, refresh },
    skill,
  );

  const openSkill = (skill: ManagedSkill, startEditing = false) => {
    setEditing({ name: skill.name, origin: skill.origin, startEditing });
  };

  const importSkill = async () => {
    const trimmed = source.trim();
    if (!trimmed) return;
    setImporting(true);
    setError("");
    setImportMessage("");
    try {
      const result = (await api(`/api/bots/${bot.id}/skills`, {
        method: "POST",
        body: JSON.stringify({ source: trimmed }),
      })) as { imported?: SkillImportSummary[] };
      setImportMessage([...skillImportLines(result.imported ?? []), t("skills.import.reviewBelow")].join(" "));
      setSource("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botPanel.skills.importError"));
    } finally {
      setImporting(false);
    }
  };

  const help = <>{featureEnabled ? t("skills.learned.hintOn") : t("skills.learned.hintOff")} {t("botPanel.skills.whenRelevant")}.</>;

  const rowActions: SkillRowActions = { libraryOn, skillWrites, working, openSkill, toggle, share, unshare, remove };

  const tail = (
    <>
      {skillWrites && <WriteCommandCard bot={bot} taken={skills.map((skill) => skill.name)} onSaved={() => void refresh()} />}

      {skillWrites && <OrgSkillsCard bot={bot} onAdded={() => void refresh()} />}

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

      {editing && (
        <SkillEditorPage
          botId={bot.id}
          target={editing}
          onClose={() => setEditing(null)}
          onPanelClose={closePanel}
          onSaved={() => void refresh()}
        />
      )}
    </>
  );

  // The bot's profile page (plain surface, #2313): one card labelled Skills,
  // the library's pick and Add a pill at the label's right; each skill a row
  // (the book icon, the name in 14px, where it comes from and what it does
  // grey under it, its switch and menu at the right). The library itself is
  // managed from Access (Manage in Plugins), not from this card.
  if (plain) {
    const addAction = renderPlainAddAction({ skillWrites, libraryOn, libraryPool, addFromLibrary, setAddFromLibrary, working, addToBot });
    return (
      <>
        <PaneSection title={t("botSettings.nav.skills")} help={help} action={addAction} plain data-skills-section="">
          <div className={PLAIN_CARD} data-settings-surface="">
            {learning && <div className="px-4 py-2.5" data-skill-learning="">{learning}</div>}
            {skillWrites && libraryOn && libraryPool.length === 0 && (
              <p className="px-4 py-2.5 text-[12.5px] text-ink-secondary">{t("botPanel.skills.allAssigned")}</p>
            )}
            {skillWrites && !libraryOn && (
              <div className="flex flex-col gap-1 px-4 py-2.5" data-skills-import="">
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void importSkill();
                  }}
                >
                  <input
                    className={PLAIN_FIELD}
                    placeholder={t("botPanel.skills.importPlaceholder")}
                    aria-label={t("botPanel.skills.importAria")}
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  />
                  <button type="submit" disabled={importing || !source.trim()} className={cn(PILL, "shrink-0")}>
                    {importing ? t("botPanel.skills.importing") : t("botPanel.skills.import")}
                  </button>
                </form>
                {importMessage && <div className="text-[12px] text-ink-secondary">{importMessage}</div>}
              </div>
            )}
            {skillWrites && (
              <div className="px-4 py-2.5">
                <SkillUpload botId={bot.id} disabled={Boolean(working)} onAdded={() => void refresh()} />
              </div>
            )}
            {loading ? (
              <p className="px-4 py-2.5 text-[12.5px] text-ink-secondary">{t("botPanel.loading")}</p>
            ) : skills.length === 0 ? (
              <p className="px-4 py-2.5 text-[12.5px] text-ink-secondary">{t("botPanel.skills.empty")}</p>
            ) : (
              skills.map((skill) => renderPlainSkillRow(rowActions, skill))
            )}
            {staged.length > 0 && (
              <p className="px-4 py-2.5 text-[12px] text-warning">
                {t(staged.length === 1 ? "botPanel.skills.proposalOne" : "botPanel.skills.proposalMany", { count: String(staged.length) })}
              </p>
            )}
            {error && <p role="alert" className="px-4 py-2.5 text-[12px] text-danger">{error}</p>}
          </div>
        </PaneSection>
        {tail}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PaneSection title={t("botPanel.skills.title")} help={help}>

        {renderClassicTop({
          skillWrites, libraryOn, libraryPool, addFromLibrary, setAddFromLibrary, working, addToBot,
          dispatch, source, setSource, importing, importMessage, importSkill,
        })}

        {learning && <div className="mt-3" data-skill-learning="">{learning}</div>}

        {skillWrites && (
          <div className="mt-3">
            <SkillUpload botId={bot.id} disabled={Boolean(working)} onAdded={() => void refresh()} />
          </div>
        )}

        {loading ? (
          <div className="mt-3 text-[12px] text-ink-secondary">{t("botPanel.loading")}</div>
        ) : skills.length === 0 ? (
          <div className="mt-3"><PaneEmpty>{t("botPanel.skills.empty")}</PaneEmpty></div>
        ) : (
          <div className="-mx-3.5 mt-3 divide-y divide-hairline/40 border-t border-hairline/40">
            {skills.map((skill) => renderClassicSkillRow(rowActions, skill))}
          </div>
        )}
        {staged.length > 0 && (
          <div className="mt-2 text-[11.5px] text-warning">
            {t(staged.length === 1 ? "botPanel.skills.proposalOne" : "botPanel.skills.proposalMany", { count: String(staged.length) })}
          </div>
        )}
        {error && <div role="alert" className="mt-2 text-[12px] text-danger">{error}</div>}
      </PaneSection>

      {tail}
    </div>
  );
}
