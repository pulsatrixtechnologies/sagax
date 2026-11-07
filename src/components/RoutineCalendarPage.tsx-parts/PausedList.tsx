import { UsersRound } from "lucide-react";
import { BotAvatar } from "@/components/Avatar";
import { DetailPanel } from "@/components/DetailPanel";
import { t } from "@/lib/i18n";
import { scheduleLabel } from "@/lib/schedule-label";
import type { Routine } from "@/lib/routines";
import { useStore, type Bot, type Group } from "@/state/store";

export function PausedList({
  routines,
  bots,
  groups,
  onClose,
  onEdit,
  onOpenRoom,
}: {
  routines: Routine[];
  bots: Bot[];
  groups: Group[];
  onClose: () => void;
  onEdit: (routine: Routine) => void;
  onOpenRoom: (id: string) => void;
}) {
  const { dispatch } = useStore();
  return (
    <DetailPanel label={t("routineCalendar.pausedTitle")} title={t("routineCalendar.pausedTitle")} closeLabel={t("routines.paused.close")} onClose={onClose} data-paused-list-panel="">
        <p className="px-4 pt-3 text-[12px] text-ink-secondary">{t("routineCalendar.pausedHistory")}</p>
        <div className="space-y-1 p-3">
          {routines.map((routine) => {
            const bot = bots.find((candidate) => candidate.id === routine.botId);
            const room = routine.target === "room-goal"
              ? groups.find((candidate) => candidate.id === routine.groupId)
              : undefined;
            return (
              <div key={routine.id} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-raised/60">
                {room ? <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent"><UsersRound size={17} /></span> : bot && <BotAvatar bot={bot} state="sleeping" size={36} animated={false} />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink">{routine.name}</div>
                  <div className="mt-0.5 truncate text-[11px] text-ink-secondary">{room ? `${t("routineCalendar.teamGoalIn", { name: room.name })} · ` : ""}{scheduleLabel(routine.schedule)}</div>
                </div>
                {room && <button onClick={() => { onOpenRoom(room.id); onClose(); }} className="rounded-lg px-2 py-1.5 text-[11px] text-ink-secondary hover:bg-inset">{t("routines.drawer.group")}</button>}
                <button onClick={() => dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: true } })} className="rounded-lg bg-accent/15 px-2.5 py-1.5 text-[11px] font-medium text-accent">{t("routines.resume")}</button>
                <button onClick={() => onEdit(routine)} className="rounded-lg px-2 py-1.5 text-[11px] text-ink-secondary hover:bg-inset">{t("routines.edit")}</button>
              </div>
            );
          })}
        </div>
    </DetailPanel>
  );
}
