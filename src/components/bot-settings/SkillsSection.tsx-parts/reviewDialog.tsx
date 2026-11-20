// The review step before a skill is switched on (moved out of
// SkillsSection.tsx so the skill rows' hook, useSkillRows, reads it without
// an import cycle).
import { t } from "@/lib/i18n";
import { PILL, PRIMARY_PILL } from "../../SettingsPrimitives";
import { PanelPage } from "../PanelPage";
import type { ManagedSkill } from "./types";

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
