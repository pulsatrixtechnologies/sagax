import { effortLabel } from "@/lib/effort-label";
// The Configuration section of a routine's page and of a run's detail
// (2026-10-29): what to do, who does it, when, where, how long, and every
// other setting the editor holds, read-only and complete. A run shows the
// instructions it ran with (its own snapshot) and, when its routine still
// exists, that routine's settings; a run of a deleted routine shows what the
// run kept. Nothing from the old details is dropped: owner, run as, the
// group of a team goal, attachments, the run limit, the cron preview.
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { personLabel } from "@/lib/human-label";
import type { Routine, RoutineRun } from "@/lib/routines";
import { durationLabel, scheduleLabel } from "@/lib/schedule-label";
import { routineAutoPauseAfter } from "../../../shared/routine-auto-pause";
import { routineAutoPauseOption } from "@/lib/routine-display";
import type { Bot, Group } from "@/state/store";
import { BotAvatar } from "@/components/Avatar";
import { CronSchedulePreview } from "./CronScheduleFields";
import { RoutineOwnerBadge } from "./RoutineScopeBar";
import { RoutineWebhookPanel } from "./RoutineWebhookPanel";
import { actAsLabel } from "./RoutineActAsField";

const LABEL = "text-[12px] font-medium text-ink-secondary";
const VALUE = "mt-1 text-[13px] leading-relaxed text-ink";

function Row({ label, children, ...rest }: { label: string; children: React.ReactNode } & Record<`data-${string}`, string | undefined>) {
  return <div {...rest}><div className={LABEL}>{label}</div><div className={VALUE}>{children}</div></div>;
}

export function RoutineConfiguration({ routine, run, bots, groups = [], viewerPrincipalId, compact = false }: {
  routine?: Routine | null;
  run?: RoutineRun | null;
  bots: Bot[];
  groups?: Group[];
  viewerPrincipalId?: string | null;
  /** The bot panel: no two-column grid. */
  compact?: boolean;
}) {
  const target = run?.target ?? routine?.target ?? "bot";
  const roomGoal = target === "room-goal";
  const botId = run?.botId ?? routine?.botId;
  const bot = bots.find((candidate) => candidate.id === botId);
  const groupId = run?.groupId ?? routine?.groupId;
  const group = groups.find((candidate) => candidate.id === groupId);
  const prompt = run?.prompt ?? routine?.prompt ?? "";
  const limit = run ? run.timeoutMinutes : routine?.timeoutMinutes;
  const attachments = run?.attachments ?? routine?.attachments ?? [];
  const otherOwner = routine?.owner?.id && routine.owner.id.toLowerCase() !== viewerPrincipalId?.toLowerCase() ? routine.owner : null;
  const runOn = run?.runOn ?? routine?.runOn;
  return (
    <div data-routine-configuration className={cn("grid gap-4", !compact && "min-[560px]:grid-cols-2")}>
      <Row label={t("routines.drawer.what")} data-routine-config-prompt="">
        {routine?.redacted || run?.redacted
          ? <span className="text-ink-secondary">{t("routines.scope.redacted")}</span>
          : <div className="max-w-[68ch] whitespace-pre-wrap break-words">{prompt || <span className="text-ink-secondary">{t("routines.noOutput")}</span>}</div>}
        {attachments.length > 0 && <ul className="mt-2 flex flex-wrap gap-1.5">{attachments.map((attachment) => <li key={attachment.id} className="rounded-md bg-inset px-2 py-0.5 text-[12px] text-ink">{attachment.name}</li>)}</ul>}
      </Row>
      <div className="space-y-4">
        <Row label={roomGoal ? t("routineCalendar.lead") : t("routineCalendar.assignedBot")} data-routine-config-bot="">
          <span className="inline-flex items-center gap-2">
            {bot && <BotAvatar bot={bot} state="idle" size={22} animated={false} />}
            <span>{bot?.name ?? routine?.bot?.name ?? t("routines.unavailableBot")}</span>
          </span>
        </Row>
        {roomGoal && <Row label={t("routineCalendar.teamGoalGroup")}>{group?.name ?? t("routineCalendar.groupUnavailable")}</Row>}
        {routine && <Row label={t("routines.drawer.schedule")} data-routine-config-schedule="">
          <span>{scheduleLabel(routine.schedule)}</span>
          {routine.schedule.type === "cron" && <div className="mt-2"><CronSchedulePreview schedule={routine.schedule} paused={!routine.enabled} /></div>}
          {routine.schedule.type === "webhook" && <div className="mt-2"><RoutineWebhookPanel routine={routine} bot={bot} /></div>}
          {routine.precheck?.kind === "watch" && <div className="mt-1 text-ink-secondary">{t("routineWatch.badge")}</div>}
        </Row>}
        <Row label={t("routines.drawer.runLimit")}>{limit == null ? t("routineCalendar.noTimeLimit") : t("routineCalendar.stopsAfter", { duration: durationLabel(limit) })}</Row>
        {runOn && <Row label={t("routines.drawer.runsOn")}>{runOn === "cloud" ? t("routines.runsOn.boat") : t("routines.runsOn.local")}</Row>}
        {routine?.runAs && <Row label={t("routines.runAsField.label")} data-routine-config-run-as="">{personLabel(routine.runAs.name, routine.runAs.principalId)}</Row>}
        {!roomGoal && (run?.actAs ?? routine?.actAs) !== undefined && <Row label={t("routineRole.label")} data-routine-config-act-as="">{actAsLabel(run?.actAs ?? routine?.actAs ?? "")}</Row>}
        {otherOwner && <Row label={t("routines.scope.owner")} data-routine-config-owner=""><RoutineOwnerBadge owner={otherOwner} size={18} className="text-[13px] text-ink" />{(routine?.canEdit === false || routine?.redacted) && <div className="mt-1 text-[12px] text-ink-secondary">{routine.redacted ? t("routines.scope.redacted") : t("routines.scope.readOnly")}</div>}</Row>}
        {routine && <Row label={t("routineDetail.options")} data-routine-config-options="">
          <ul className="space-y-0.5">
            <li>{t("routines.overlapLabel")}: {routine.overlap === "queue" ? t("routines.overlapQueue") : t("routines.overlapSkip")}</li>
            <li>{t("routines.continuityLabel")}: {routine.continuity ? t("routineDetail.on") : t("routineDetail.off")}</li>
            {routine.target === "bot" && <li>{t("routines.postResults.label")}: {routine.postResults === false ? t("routineDetail.off") : t("routineDetail.on")}</li>}
            <li>{t("routines.away.onlyLabel")}: {routine.onlyWhenPresent ? t("routineDetail.on") : t("routineDetail.off")}</li>
            {routine.deleteWhenFinished && <li data-routine-delete-when-finished="">{t("routines.deleteWhenFinished.willDelete")}</li>}
            <li>{t("routines.autoPause.label")}: {routineAutoPauseOption(routineAutoPauseAfter(routine))}</li>
            {routine.mailAlias && <li>{t("routines.mailAlias.label")}: +{routine.mailAlias}</li>}
            {routine.model && <li data-routine-config-model="">{t("routines.model.label")}: {routine.model}</li>}
            {routine.effort && <li data-routine-config-effort="">{t("routines.effort.label")}: {effortLabel(routine.effort)}</li>}
            {routine.folder && <li>{t("routineDetail.folder")}: {routine.folder}</li>}
          </ul>
        </Row>}
      </div>
    </div>
  );
}
