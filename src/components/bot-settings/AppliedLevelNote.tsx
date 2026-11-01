// 2026-10-28 (one source of truth): the approval level the open
// conversation really runs at, when it is not the bot's own setting, as the
// server judges its turns (WireBot.approvalApplied, shared/approval-mode.ts
// appliedLevelReason). The selector above shows the bot's setting; this
// line says, in words, why this conversation differs and offers the way
// back where there is one. Nothing is shown when both are the same.
import { TriangleAlert } from "lucide-react";

import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { AppliedApprovalLevel, AppliedLevelReason, ApprovalMode } from "../../../shared/approval-mode";

const REASON: Record<AppliedLevelReason, LocaleKey> = {
  thread: "approvalApplied.reason.thread",
  delegated: "approvalApplied.reason.delegated",
  engine: "approvalApplied.reason.engine",
  safety: "approvalApplied.reason.safety",
  pending: "approvalApplied.reason.pending",
  consent: "approvalApplied.reason.consent",
  "member-policy": "approvalApplied.reason.memberPolicy",
  "engine-unsupported": "approvalApplied.reason.engineUnsupported",
  guest: "approvalApplied.reason.guest",
  mail: "approvalApplied.reason.mail",
};

/** The reasons the person can undo from here: the conversation follows the
 * bot again, or Full access gets its confirmation. */
const FIXABLE: ReadonlySet<AppliedLevelReason> = new Set(["thread", "delegated", "engine", "safety", "consent"]);

function levelName(mode: ApprovalMode): string {
  return t(`approvalMode.${mode}.label` as LocaleKey);
}

export function appliedLevelLine(applied: AppliedApprovalLevel): string {
  return t("approvalApplied.line", { level: levelName(applied.mode), reason: t(REASON[applied.reason]) });
}

export function AppliedLevelNote({ setting, applied, onUseSetting }: { setting: ApprovalMode; applied: AppliedApprovalLevel; onUseSetting?: () => void }) {
  if (applied.mode === setting) return null;
  return (
    <div
      role="note"
      data-approval-applied={applied.mode}
      data-approval-applied-reason={applied.reason}
      className="mx-4 mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink-secondary"
    >
      <TriangleAlert size={13} aria-hidden="true" className="shrink-0 text-warning" />
      <span className="min-w-0 flex-1 text-ink">{appliedLevelLine(applied)}</span>
      {onUseSetting && FIXABLE.has(applied.reason) && (
        <button type="button" data-approval-applied-fix="" onClick={onUseSetting} className="shrink-0 text-accent hover:underline">
          {applied.reason === "consent" ? t("approvalApplied.confirmFull") : t("approvalApplied.useSetting", { level: levelName(setting) })}
        </button>
      )}
    </div>
  );
}
