// 2026-10-28 (one source of truth): the approval level the open
// conversation really runs at, when it is not the bot's own setting, as the
// server judges its turns (WireBot.approvalApplied, shared/approval-mode.ts
// appliedLevelReason). The selector above shows the bot's setting; this
// line says, in words, why this conversation differs. #4200: a conversation
// holds no level of its own any more, so there is no way back to offer from
// here; Full access that waits for its owner's confirmation keeps its
// button. Nothing is shown when both are the same.
import { TriangleAlert } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { PILL, useSettingsSurface } from "../SettingsPrimitives";
import type { AppliedApprovalLevel, AppliedLevelReason, ApprovalMode } from "../../../shared/approval-mode";

const REASON: Record<AppliedLevelReason, LocaleKey> = {
  delegated: "approvalApplied.reason.delegated",
  pending: "approvalApplied.reason.pending",
  consent: "approvalApplied.reason.consent",
  "member-policy": "approvalApplied.reason.memberPolicy",
  "engine-unsupported": "approvalApplied.reason.engineUnsupported",
  guest: "approvalApplied.reason.guest",
  mail: "approvalApplied.reason.mail",
};

function levelName(mode: ApprovalMode): string {
  return t(`approvalMode.${mode}.label` as LocaleKey);
}

export function appliedLevelLine(applied: AppliedApprovalLevel): string {
  return t("approvalApplied.line", { level: levelName(applied.mode), reason: t(REASON[applied.reason]) });
}

export function AppliedLevelNote({ setting, applied, onConfirmFull }: { setting: ApprovalMode; applied: AppliedApprovalLevel; onConfirmFull?: () => void }) {
  // The bot's profile page (#2313): the note reads as the row's subtitle,
  // with no box of its own, and the way back is a plain pill.
  const plain = useSettingsSurface() === "plain";
  if (applied.mode === setting) return null;
  return (
    <div
      role="note"
      data-approval-applied={applied.mode}
      data-approval-applied-reason={applied.reason}
      className={plain
        ? "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-2.5 text-[12px] leading-4 text-ink-secondary"
        : "mx-4 mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink-secondary"}
    >
      <TriangleAlert size={13} aria-hidden="true" className="shrink-0 text-warning" />
      <span className={cn("min-w-0 flex-1", !plain && "text-ink")}>{appliedLevelLine(applied)}</span>
      {onConfirmFull && applied.reason === "consent" && (
        <button type="button" data-approval-applied-fix="" onClick={onConfirmFull} className={plain ? cn(PILL, "shrink-0") : "shrink-0 text-accent hover:underline"}>
          {t("approvalApplied.confirmFull")}
        </button>
      )}
    </div>
  );
}
