// Skills: durable behavior the bot learned or imported, so the user needs a
// normal way to inspect, disable, and remove it after the one-time approval
// card is gone. Moved from SettingsPanel.tsx's LearnedSkillsCard (79-295),
// its nested review dialog raised from z-[80] to z-[90] to float above this
// dialog's own z-50, plus: an Import from GitHub row, a static "when it's
// used" line on every row (learned skills have no triggers to show), and a
// click-through skill editor (MarkdownEditor, same as MEMORY.md / RULES.md).
import { ArrowUpRight, Ellipsis, Eye, Pencil, Share2, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ConfirmProvider";
import { t } from "@/lib/i18n";
import { skillImportLines } from "@/lib/skill-import";
import type { SkillImportSummary } from "../../../shared/skill-import";
import { useEffect, useRef, useState } from "react";

import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./BotEditorContext";
import { skillAuthoringEnabled, skillsLibraryEnabled } from "@/lib/feature-flags";
import { skillSourceLabel } from "@/lib/skills-ui";
import { viewerBotsReadOnly } from "@/lib/viewer";
import { InlineFold, PILL, PillSelect, PRIMARY_PILL, Switch } from "../SettingsPrimitives";
import { inputCls } from "./field";
import { cn } from "@/lib/cn";
import { PaneEmpty, PaneSection } from "./PaneSection";
import { OrgSkillsCard } from "./OrgSkillsCard";
import { SkillUpload } from "./SkillUpload";
import { WriteCommandCard } from "./WriteCommandCard";
import { PanelPage } from "./PanelPage";
import { MenuItem, PopoverMenu } from "./FilesSection";
import { SkillEditorPage, type SkillEditorTarget } from "./SkillEditorPage";

export interface ManagedSkill {
  name: string;
  description: string;
  enabled: boolean;
  source: string;
  warnings: string[];
  /** Present under features.skillsLibrary (and for engine-native skills always):
   * where the bot reads this skill from. Private shadows me, library and native
   * on name collision. "native": loaded by the engine from a folder of its own. */
  origin?: "private" | "library" | "me" | "native";
  /** Shared skills: bots that still link to the one copy. */
  assignedBots?: Array<{ id: string; name: string }>;
}

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
  const closePanel = () => {
    dispatch({ type: "toggleSettings", open: false });
    dispatch({ type: "toggleComputer", open: false });
  };

  useEffect(() => {
    setEditing(null);
  }, [bot.id]);

  const remove = async (skill: ManagedSkill) => {
    if (skill.origin === "library") {
      if (assignmentBusy.current) return;
      if (!(await confirm({
        title: t("botPanel.skills.unassignConfirm", { name: skill.name }),
        confirmLabel: t("botPanel.skills.removeTitle"),
        tone: "danger",
      }))) return;
      assignmentBusy.current = true;
      setWorking(skill.name);
      setError("");
      try {
        await putAssignments(skill.name, true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t("botPanel.skills.unassignError"));
      } finally {
        assignmentBusy.current = false;
        setWorking("");
      }
      return;
    }
    if (skill.origin === "me") {
      await unshare(skill);
      return;
    }
    if (!(await confirm({
      title: t("botPanel.skills.removeLearnedConfirm", { name: skill.name }),
      confirmLabel: t("botPanel.skills.removeTitle"),
      tone: "danger",
    }))) return;
    setWorking(skill.name);
    setError("");
    try {
      await api(`/api/bots/${bot.id}/skills/${encodeURIComponent(skill.name)}`, { method: "DELETE" });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botPanel.skills.removeError"));
    } finally {
      setWorking("");
    }
  };

  const openSkill = (skill: ManagedSkill, startEditing = false) => {
    setEditing({ name: skill.name, origin: skill.origin, startEditing });
  };

  const originLabel = (skill: ManagedSkill) => {
    if (skill.origin === "native") return t("skills.origin.native");
    if (skill.origin === "me" || skill.origin === "library") return t("botPanel.skills.originShared");
    return t("botPanel.skills.originPrivate");
  };

  const changedAfterReview = (skill: ManagedSkill) =>
    skill.warnings.some((warning) => warning.includes("changed after review"));

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

  return (
    <div className="flex flex-col gap-5">
      <PaneSection title={t("botPanel.skills.title")} help={<>{featureEnabled ? t("skills.learned.hintOn") : t("skills.learned.hintOff")} {t("botPanel.skills.whenRelevant")}.</>}>

        {skillWrites && libraryOn ? (
          <div className="flex flex-col gap-1.5">
            {libraryPool.length > 0 ? (
              <div className="flex items-center gap-2">
                <PillSelect
                  ariaLabel={t("botPanel.skills.addAria")}
                  value={addFromLibrary}
                  disabled={Boolean(working)}
                  onChange={setAddFromLibrary}
                  options={[
                    { value: "", label: t("botPanel.skills.addPlaceholder") },
                    ...libraryPool.map((skill) => ({ value: skill.name, label: skill.name })),
                  ]}
                />
                <button
                  type="button"
                  disabled={!addFromLibrary || Boolean(working)}
                  onClick={() => void addToBot()}
                  className={cn(PRIMARY_PILL, "ml-auto shrink-0")}
                >
                  {t("common.add")}
                </button>
              </div>
            ) : (
              <div className="text-[12px] text-ink-secondary">{t("botPanel.skills.allAssigned")}</div>
            )}
            {/* The library itself (new, edit, delete) lives in Connect apps > Installed. */}
            <button
              type="button"
              data-manage-in-connect-apps="skills"
              onClick={() => {
                dispatch({ type: "toggleSettings", open: false });
                dispatch({ type: "togglePlugins", open: true });
              }}
              className="flex items-center gap-1 self-start rounded-lg px-1 py-1 text-[12.5px] font-medium text-accent-text hover:underline"
            >
              {t("botPanel.skills.manageInConnectApps")} <ArrowUpRight size={13} aria-hidden="true" />
            </button>

          </div>
        ) : skillWrites ? (
          <>
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void importSkill();
              }}
            >
              <input
                className={inputCls}
                placeholder={t("botPanel.skills.importPlaceholder")}
                aria-label={t("botPanel.skills.importAria")}
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
              <button
                type="submit"
                disabled={importing || !source.trim()}
                className="shrink-0 rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
              >
                {importing ? t("botPanel.skills.importing") : t("botPanel.skills.import")}
              </button>
            </form>
            {importMessage && <div className="mt-1 text-[12px] text-ink-secondary">{importMessage}</div>}
          </>
        ) : null}

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
            {skills.map((skill) => (
              <div key={skill.name} className="px-3.5 py-2.5" data-skill-row={skill.name}>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openSkill(skill)}
                    className="min-w-0 flex-1 text-left"
                    data-skill-open={skill.name}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <div className="truncate font-mono text-[12.5px] text-ink">{skill.name}</div>
                      {(libraryOn || skill.origin === "native") && (
                        <span
                          className="shrink-0 rounded bg-control px-1 py-px font-mono text-[9.5px] uppercase tracking-wide text-ink-secondary"
                          title={skill.origin === "native" ? t("skills.origin.nativeHint") : undefined}
                        >
                          {originLabel(skill)}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[11.5px] text-ink-secondary">{skill.description}</div>
                  </button>
                  {skillWrites && skill.origin !== "native" && (
                    <>
                      <Switch
                        checked={skill.enabled}
                        aria-label={t(skill.enabled ? "botPanel.skills.disable" : "botPanel.skills.enable", { name: skill.name })}
                        disabled={Boolean(working)}
                        onClick={() => void toggle(skill)}
                      />
                      <PopoverMenu
                        label={t("botPanel.skills.rowMenu", { name: skill.name })}
                        menuLabel={t("botPanel.skills.rowMenu", { name: skill.name })}
                        icon={<Ellipsis size={15} />}
                        buttonClass="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-40"
                        data-skill-row-menu={skill.name}
                      >
                        {(close) => (
                          <>
                            <MenuItem icon={<Eye size={14} />} label={t("botPanel.skills.open")} onClick={() => { close(); openSkill(skill); }} />
                            <MenuItem icon={<Pencil size={14} />} label={t("botPanel.skills.edit")} onClick={() => { close(); openSkill(skill, true); }} />
                            {libraryOn && skill.origin === "private" && (
                              <MenuItem
                                icon={<Share2 size={14} />}
                                label={t("botPanel.skills.shareMe")}
                                disabled={Boolean(working)}
                                onClick={() => { close(); void share(skill, "me"); }}
                              />
                            )}
                            {libraryOn && (skill.origin === "me" || skill.origin === "library") && (
                              <MenuItem
                                icon={<Share2 size={14} />}
                                label={t("botPanel.skills.unshare")}
                                disabled={Boolean(working)}
                                onClick={() => { close(); void unshare(skill); }}
                              />
                            )}
                            <MenuItem
                              icon={<Trash2 size={14} />}
                              label={t("botPanel.skills.removeTitle")}
                              disabled={Boolean(working)}
                              onClick={() => { close(); void remove(skill); }}
                            />
                          </>
                        )}
                      </PopoverMenu>
                    </>
                  )}
                  {skill.origin === "native" && (
                    <button
                      type="button"
                      onClick={() => openSkill(skill)}
                      className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
                      aria-label={t("botPanel.skills.open")}
                    >
                      <Eye size={15} />
                    </button>
                  )}
                </div>
                {skill.source && (
                  <div className="mt-1" data-skill-source={skill.name}>
                    <InlineFold label={t("botPanel.skills.sourceLabel", { label: skillSourceLabel(skill.source) })}>
                      <p className="break-all font-mono text-[10px] text-ink-secondary" title={skill.source}>{skill.source}</p>
                    </InlineFold>
                  </div>
                )}
                {libraryOn && (skill.origin === "me" || skill.origin === "library") && skill.assignedBots && skill.assignedBots.length > 0 && (
                  <div className="mt-1 text-[10.5px] text-ink-secondary">
                    {t("botPanel.skills.sharedWith", { bots: skill.assignedBots.map((entry) => entry.name).join(", ") })}
                  </div>
                )}
                {changedAfterReview(skill) ? (
                  <div className="mt-1 text-[10.5px] text-warning" data-skill-warning={skill.name}>
                    <span>{t("botPanel.skills.changedAfterReview")}</span>
                    {" · "}
                    <button
                      type="button"
                      className="font-medium text-accent-text hover:underline"
                      onClick={() => openSkill(skill)}
                    >
                      {t("botPanel.skills.reviewChanges")}
                    </button>
                  </div>
                ) : skill.warnings.length > 0 ? (
                  <div className="mt-1 text-[10.5px] text-warning">{skill.warnings.join(" · ")}</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {staged.length > 0 && (
          <div className="mt-2 text-[11.5px] text-warning">
            {t(staged.length === 1 ? "botPanel.skills.proposalOne" : "botPanel.skills.proposalMany", { count: String(staged.length) })}
          </div>
        )}
        {error && <div role="alert" className="mt-2 text-[12px] text-danger">{error}</div>}
      </PaneSection>

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
    </div>
  );
}
