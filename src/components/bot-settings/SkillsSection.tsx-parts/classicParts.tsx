import { ArrowUpRight, Eye } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { skillSourceLabel } from "@/lib/skills-ui";
import type { useStore } from "@/state/store";
import { InlineFold, PillSelect, PRIMARY_PILL, Switch } from "../../SettingsPrimitives";
import { inputCls } from "../field";
import { changedAfterReview, originLabel } from "./helpers";
import { renderRowMenu } from "./rowMenu";
import type { ManagedSkill, SkillRowActions } from "./types";

export interface ClassicTopProps {
  skillWrites: boolean;
  libraryOn: boolean;
  libraryPool: Array<{ name: string }>;
  addFromLibrary: string;
  setAddFromLibrary: (name: string) => void;
  working: string;
  addToBot: () => unknown;
  dispatch: ReturnType<typeof useStore>["dispatch"];
  source: string;
  setSource: (value: string) => void;
  importing: boolean;
  importMessage: string;
  importSkill: () => unknown;
}

export function renderClassicTop(p: ClassicTopProps): ReactNode {
  const { skillWrites, libraryOn, libraryPool, addFromLibrary, setAddFromLibrary, working, addToBot, dispatch, source, setSource, importing, importMessage, importSkill } = p;
  return (
        skillWrites && libraryOn ? (
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
        ) : null
  );
}

export function renderClassicSkillRow(a: SkillRowActions, skill: ManagedSkill) {
  const { libraryOn, skillWrites, working, openSkill, toggle } = a;
  return (
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
                {renderRowMenu(a, skill, "flex size-8 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-40")}
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
  );
}
