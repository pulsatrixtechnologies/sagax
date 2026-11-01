// Skills: durable behavior the bot learned or imported, so the user needs a
// normal way to inspect, disable, and remove it after the one-time approval
// card is gone. Moved from SettingsPanel.tsx's LearnedSkillsCard (79-295),
// its nested review dialog raised from z-[80] to z-[90] to float above this
// dialog's own z-50, plus: an Import from GitHub row, a static "when it's
// used" line on every row (learned skills have no triggers to show), and a
// read-only click-through view of a skill's full text.
import { ArrowUpRight, Trash2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";

import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./BotEditorContext";
import { skillAuthoringEnabled, skillsLibraryEnabled } from "@/lib/feature-flags";
import { viewerBotsReadOnly } from "@/lib/viewer";
import { DIALOG, DialogCloseButton, PILL, PillSelect, PRIMARY_PILL, Switch } from "../SettingsPrimitives";
import { inputCls } from "./field";
import { cn } from "@/lib/cn";
import { PaneEmpty, PaneSection } from "./PaneSection";
import { OrgSkillsCard } from "./OrgSkillsCard";
import { SkillUpload } from "./SkillUpload";
import { WriteCommandCard } from "./WriteCommandCard";

export interface ManagedSkill {
  name: string;
  description: string;
  enabled: boolean;
  source: string;
  warnings: string[];
  /** Present only under features.skillsLibrary: where the bot reads this
   * skill from. Private shadows me and library on name collision. */
  origin?: "private" | "library" | "me";
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
    if (!window.confirm(t("botPanel.skills.unshareConfirm", { name: skill.name }))) return;
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

/** The review step before a skill is switched on: its full SKILL.md, with
 * Escape and a focus trap, layered above the settings panel. */
export function SkillReviewDialog({
  skill,
  text,
  error,
  working,
  onCancel,
  onEnable,
}: {
  skill: ManagedSkill;
  text: string;
  error: string;
  working: boolean;
  onCancel: () => void;
  onEnable: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const parentDialog = dialog?.parentElement?.closest<HTMLElement>('[role="dialog"]');
    dialog?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!working) cancel.current();
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]');
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previousFocus && previousFocus !== document.body && previousFocus.isConnected) previousFocus.focus();
      else parentDialog?.focus();
    };
  }, [working]);

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="skill-review-title"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-6"
    >
      <div className={cn(DIALOG.frame, DIALOG.width.xl, "max-h-[min(760px,90vh)] p-5")}>
        <div id="skill-review-title" className={DIALOG.title}>
          {t("botPanel.skills.reviewTitle", { name: skill.name })}
        </div>
        <div className="mt-1 break-all text-[11.5px] text-ink-secondary">
          {t("botPanel.skills.source", { source: skill.source })}
        </div>
        {skill.warnings.length > 0 && (
          <div className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-[11.5px] text-warning">
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
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={working}
            onClick={onCancel}
            className={PILL}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={working}
            onClick={onEnable}
            className={PRIMARY_PILL}
          >
            {t("botPanel.skills.enableReviewed")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SkillsSection({ bot }: { bot: Bot }) {
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
  const [viewing, setViewing] = useState<{ name: string; text: string } | null>(null);
  const [source, setSource] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const skillDialogRef = useRef<HTMLDivElement>(null);
  const skillDialogOpen = Boolean(viewing);

  useEffect(() => {
    if (!skillDialogOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = skillDialogRef.current;
    const parentDialog = dialog?.parentElement?.closest<HTMLElement>('[role="dialog"]');
    dialog?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!working) setViewing(null);
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]');
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previousFocus && previousFocus !== document.body && previousFocus.isConnected) previousFocus.focus();
      else parentDialog?.focus();
    };
  }, [skillDialogOpen, working]);

  useEffect(() => {
    setViewing(null);
  }, [bot.id]);

  const remove = async (skill: ManagedSkill) => {
    if (skill.origin === "library") {
      if (assignmentBusy.current) return;
      if (!window.confirm(`Unassign “${skill.name}” from this bot? The skill stays in the library.`)) return;
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
    if (!window.confirm(`Remove the learned skill “${skill.name}”?`)) return;
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

  const view = async (skill: ManagedSkill) => {
    setError("");
    try {
      const path = skill.origin === "library"
        ? `/api/skills-library/${encodeURIComponent(skill.name)}`
        : skill.origin === "me"
          ? `/api/me/skills-library/${encodeURIComponent(skill.name)}`
          : `/api/bots/${bot.id}/skills/${encodeURIComponent(skill.name)}`;
      const result = (await api(path)) as { text?: string };
      setViewing({ name: skill.name, text: result.text ?? "" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botPanel.skills.viewError"));
    }
  };

  const originLabel = (skill: ManagedSkill) => {
    if (skill.origin === "me" || skill.origin === "library") return t("botPanel.skills.originShared");
    return t("botPanel.skills.originPrivate");
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
      })) as { installed?: unknown[] };
      const count = (result.installed ?? []).length;
      setImportMessage(count === 1
        ? t("botPanel.skills.importedOne", { count: String(count) })
        : t("botPanel.skills.importedMany", { count: String(count) }));
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
            {/* The library itself (new, edit, delete) is in Connect apps. */}
            <button
              type="button"
              data-manage-in-connect-apps="skills"
              onClick={() => {
                dispatch({ type: "toggleSettings", open: false });
                dispatch({ type: "togglePlugins", open: true });
              }}
              className="flex items-center gap-1 self-start rounded-lg px-1 py-1 text-[12.5px] font-medium text-accent-text hover:underline"
            >
              {t("botAccess.manageInConnectApps")} <ArrowUpRight size={13} aria-hidden="true" />
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
              <div key={skill.name} className="px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void view(skill)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <div className="truncate font-mono text-[12.5px] text-ink">{skill.name}</div>
                      {libraryOn && (
                        <span className="shrink-0 rounded bg-control px-1 py-px font-mono text-[9.5px] uppercase tracking-wide text-ink-secondary">
                          {originLabel(skill)}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[11.5px] text-ink-secondary">{skill.description}</div>
                  </button>
                  {skillWrites && (
                    <>
                      <Switch
                        checked={skill.enabled}
                        aria-label={t(skill.enabled ? "botPanel.skills.disable" : "botPanel.skills.enable", { name: skill.name })}
                        disabled={Boolean(working)}
                        onClick={() => void toggle(skill)}
                      />
                      <button
                        aria-label={t("botPanel.skills.removeAria", { name: skill.name })}
                        title={t("botPanel.skills.removeTitle")}
                        disabled={Boolean(working)}
                        onClick={() => void remove(skill)}
                        className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
                <div className="mt-1 truncate text-[10.5px] text-ink-secondary" title={skill.source}>{t("botPanel.skills.source", { source: skill.source })}</div>
                {libraryOn && (skill.origin === "me" || skill.origin === "library") && skill.assignedBots && skill.assignedBots.length > 0 && (
                  <div className="mt-1 text-[10.5px] text-ink-secondary">
                    {t("botPanel.skills.sharedWith", { bots: skill.assignedBots.map((entry) => entry.name).join(", ") })}
                  </div>
                )}
                {skillWrites && libraryOn && skill.origin === "private" && (
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={Boolean(working)}
                      onClick={() => void share(skill, "me")}
                      className="rounded-lg bg-control px-2.5 py-1 text-[11.5px] text-ink hover:bg-raised-hover disabled:opacity-50"
                    >
                      {t("botPanel.skills.shareMe")}
                    </button>
                  </div>
                )}
                {skillWrites && libraryOn && (skill.origin === "me" || skill.origin === "library") && (
                  <div className="mt-1.5">
                    <button
                      type="button"
                      disabled={Boolean(working)}
                      onClick={() => void unshare(skill)}
                      className="rounded-lg bg-control px-2.5 py-1 text-[11.5px] text-ink hover:bg-raised-hover disabled:opacity-50"
                    >
                      {t("botPanel.skills.unshare")}
                    </button>
                  </div>
                )}
                {skill.warnings.length > 0 && (
                  <div className="mt-1 text-[10.5px] text-warning">{skill.warnings.join(" · ")}</div>
                )}
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
        />
      )}

      {viewing && (
        <div
          ref={skillDialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="skill-view-title"
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-6"
        >
          <div className={cn(DIALOG.frame, DIALOG.width.xl, "max-h-[min(760px,90vh)] p-5")}>
            <DialogCloseButton label={t("botPanel.skills.close")} onClick={() => setViewing(null)} />
            <div className="pr-10">
              <div id="skill-view-title" className={DIALOG.title}>{viewing.name}</div>
            </div>
            <pre
              tabIndex={0}
              aria-label={t("botPanel.skills.fullText", { name: viewing.name })}
              className="mt-3 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-inset p-3 font-mono text-[12px] leading-relaxed text-ink"
            >
              {viewing.text}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
