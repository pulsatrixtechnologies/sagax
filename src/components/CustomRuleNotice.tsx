// The rule notice: which of the person's custom rules approved, refused or
// held an action (shared/custom-rules.ts), in their own words, with a way
// to edit it. Shown on the approval box, on a settled card's receipt and
// under a step a rule answered with no card.
//
// 2026-10-21 (Grok Bot parity lot 1A): an organization admin's rule says so
// ("Exigé par votre administrateur") and offers no edit; a rule whose words
// change shows what changed, word by word (RuleTextDiff).
//
// 2026-10-21 (lot A1): a rule the model reviewer applied (examen
// automatique) says so, with its reason in one sentence.
import { Lock, ShieldCheck, ShieldX, ShieldAlert } from "lucide-react";

import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { useStore } from "@/state/store";
import { ruleTextDiff, type CustomRuleNotice as Notice, type RiskClass } from "../../shared/custom-rules";

export const RISK_LABEL: Record<RiskClass, LocaleKey> = {
  destructive: "customRules.risk.destructive",
  irreversible: "customRules.risk.irreversible",
  money: "customRules.risk.money",
  "external-send": "customRules.risk.externalSend",
};

export function riskList(risks: readonly RiskClass[]): string {
  return risks.map((risk) => t(RISK_LABEL[risk])).join(", ");
}

/** The one line a notice reads as. */
export function customRuleNoticeLine(notice: Notice): string {
  // 2026-10-21 (Grok Bot parity A1): the model reviewer applied the rule
  if (notice.reviewer === "model") {
    if (notice.org) return t(notice.outcome === "denied" ? "customRules.notice.modelOrgDenied" : "customRules.notice.modelOrgHeld");
    if (notice.outcome === "approved") return t("customRules.notice.modelApproved");
    if (notice.outcome === "denied") return t("customRules.notice.modelDenied");
    return t("customRules.notice.modelHeld");
  }
  if (notice.org && notice.outcome === "denied") return t("customRules.notice.orgDenied");
  if (notice.org && notice.outcome === "held") return t("customRules.notice.orgHeld");
  if (notice.outcome === "approved") return t("customRules.notice.approved");
  if (notice.outcome === "denied") return t("customRules.notice.denied");
  if (notice.outcome === "held") return t("customRules.notice.held");
  return t("customRules.notice.risk", { kinds: riskList(notice.missing ?? []) });
}

export function EditCustomRuleLink({ botId }: { botId?: string | null }) {
  const { dispatch } = useStore();
  return (
    <button
      type="button"
      data-custom-rule-edit
      className="text-accent hover:underline"
      onClick={() => dispatch({ type: "toggleSettings", open: true, section: "permissions", ...(botId ? { botId } : {}) })}
    >
      {t("customRules.notice.edit")}
    </button>
  );
}

export function CustomRuleNoticeLine({ notice, botId, compact = false }: { notice: Notice; botId?: string | null; compact?: boolean }) {
  const Icon = notice.outcome === "approved" ? ShieldCheck : notice.outcome === "denied" ? ShieldX : ShieldAlert;
  const tone = notice.outcome === "approved" ? "text-success" : notice.outcome === "denied" ? "text-danger" : "text-warning";
  return (
    <div
      data-custom-rule-notice={notice.outcome}
      className={compact ? "flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11.5px] text-ink-secondary" : "mt-2 flex min-w-0 flex-wrap items-center gap-x-1.5 rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink-secondary"}
    >
      <Icon size={compact ? 12 : 14} aria-hidden="true" className={`shrink-0 ${tone}`} />
      <span className="font-medium text-ink">{customRuleNoticeLine(notice)}</span>
      <span className="min-w-0 break-words">« {notice.when} »</span>
      {notice.org ? <OrgRuleBadge /> : <EditCustomRuleLink botId={notice.botId ?? botId} />}
      {notice.reason && <span data-custom-rule-reason="" className="basis-full min-w-0 break-words text-ink-secondary">{notice.reason}</span>}
    </div>
  );
}

/** "Exigé par votre administrateur": an organization rule, which nobody
 * but an organization admin changes. */
export function OrgRuleBadge() {
  return (
    <span data-org-rule="" title={t("customRules.org.locked")} className="inline-flex items-center gap-1 text-ink-tertiary">
      <Lock size={11} aria-hidden="true" />
      {t("customRules.org.required")}
    </span>
  );
}

/** What changes in a rule's words: removed words struck, added words
 * marked. Nothing when the words are the same. */
export function RuleTextDiff({ before, after }: { before: string; after: string }) {
  if (before.trim() === after.trim()) return null;
  const parts = ruleTextDiff(before.trim(), after.trim());
  return (
    <p data-rule-diff="" className="text-[12px] text-ink-secondary">
      <span className="mr-1.5 text-ink-tertiary">{t("customRules.diff.label")}</span>
      {parts.map((part, index) => part.kind === "same"
        ? <span key={index}>{part.text}</span>
        : part.kind === "removed"
          ? <del key={index} data-rule-diff-removed="" className="mr-1 text-danger line-through decoration-danger/60">{part.text}</del>
          : <mark key={index} data-rule-diff-added="" className="rounded-sm bg-success/15 px-0.5 text-ink">{part.text}</mark>)}
    </p>
  );
}

/** "Added to your Allow rules", under a card answered with Always allow this. */
export function CustomRuleSavedInset({ rule, botId }: { rule: { id: string; when: string }; botId?: string | null }) {
  return (
    <div data-custom-rule-saved={rule.id} className="mt-2 rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink-secondary">
      <div className="font-medium text-ink">{t("customRules.saved")}</div>
      <div className="mt-0.5 break-words">« {rule.when} »</div>
      <EditCustomRuleLink botId={botId} />
    </div>
  );
}
