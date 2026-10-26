// "Disabled · 5 routines" (2026-10-15, JC, after Grok Bot): one quiet,
// centered line in the conversation when a turn turned routines on or off
// (server/routine-chat-events.ts writes it, one per action and per turn).
// It opens a small menu of the routines it names; a routine the person can
// still open goes to its page in its bot's panel. The server sends each
// person only the routines they can see.
import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";

import { cn } from "@/lib/cn";
import { useStore, type Message } from "@/state/store";
import { t } from "@/lib/i18n";
import type { RoutineToggleEvent } from "../../shared/wire";
import { useMenuMotion } from "./MenuMotion";

/** "Disabled" or "Enabled", in the person's language. */
export function routineToggleActionLabel(action: RoutineToggleEvent["action"]): string {
  return action === "disabled" ? t("chat.routineToggle.disabled") : t("chat.routineToggle.enabled");
}

/** Whether this line is a definition change (one named routine) rather than a
 * count of routines turned on or off. */
export function isRoutineChangeAction(action: RoutineToggleEvent["action"]): boolean {
  return action === "created" || action === "updated" || action === "deleted";
}

/** "Created routine", "Updated routine" or "Deleted routine". */
export function routineChangeActionLabel(action: "created" | "updated" | "deleted"): string {
  return t(`chat.routineChange.${action}`);
}

/** The "Updated routine · <name>" chip a bot's routine change leaves in the
 * conversation. One routine, named (never its id); it opens the routine when
 * it still exists in the person's list and was not the one deleted. */
export function RoutineChangeLine({ event, canOpen, onOpen }: {
  event: RoutineToggleEvent;
  canOpen: (routineId: string) => boolean;
  onOpen: (routine: RoutineToggleEvent["routines"][number]) => void;
}) {
  const routine = event.routines[0];
  if (!routine || !isRoutineChangeAction(event.action)) return null;
  const action = routineChangeActionLabel(event.action as "created" | "updated" | "deleted");
  const opens = event.action !== "deleted" && canOpen(routine.id);
  const inner = (
    <>
      <span>{action}</span>
      <span aria-hidden="true">·</span>
      <Clock size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
      <span dir="auto" className="max-w-[220px] truncate">{routine.name}</span>
    </>
  );
  const classes = "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] leading-4 text-ink-tertiary";
  return (
    <div className="flex justify-center py-0.5" data-routine-change={event.action}>
      {opens ? (
        <button
          type="button"
          title={routine.name}
          aria-label={t("chat.routineChange.aria", { action, name: routine.name })}
          onClick={() => onOpen(routine)}
          className={cn(classes, "transition-colors hover:bg-hover hover:text-ink-secondary")}
        >
          {inner}
        </button>
      ) : (
        <span className={classes} title={routine.name} aria-label={`${action}: ${routine.name}`}>
          {inner}
        </span>
      )}
    </div>
  );
}

/** "1 routine", "5 routines". */
export function routineToggleCountLabel(count: number): string {
  return count === 1 ? t("chat.routineToggle.countOne", { count }) : t("chat.routineToggle.countMany", { count });
}

export function RoutineToggleLine({ event, canOpen, onOpen }: {
  event: RoutineToggleEvent;
  /** whether this routine still opens for the person (it is in their list) */
  canOpen: (routineId: string) => boolean;
  onOpen: (routine: RoutineToggleEvent["routines"][number]) => void;
}) {
  const [open, setOpen] = useState(false);
  const motion = useMenuMotion(open);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") setOpen(false);
    };
    const onPointerDown = (pointerEvent: PointerEvent) => {
      if (pointerEvent.target instanceof Node && !ref.current?.contains(pointerEvent.target)) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);
  if (!event.routines.length) return null;
  const action = routineToggleActionLabel(event.action);
  const count = routineToggleCountLabel(event.routines.length);
  return (
    <div className="flex justify-center py-0.5" data-routine-toggle={event.action}>
      <div ref={ref} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("chat.routineToggle.aria", { action, routines: count })}
          onClick={() => setOpen((current) => !current)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] leading-4 text-ink-tertiary transition-colors hover:bg-hover hover:text-ink-secondary",
            open && "bg-hover text-ink-secondary",
          )}
        >
          <span>{action}</span>
          <span aria-hidden="true">·</span>
          <Clock size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          <span>{count}</span>
        </button>
        {motion.shown && (
          <div
            role="menu"
            aria-label={t("chat.routineToggle.menuAria")}
            data-routine-toggle-menu
            className={cn(
              "absolute left-1/2 top-full z-40 mt-1 flex w-[300px] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col gap-0.5 overflow-hidden rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5",
              motion.className,
            )}
            {...motion.exitProps}
          >
            {event.routines.map((routine) => {
              const opens = canOpen(routine.id);
              return (
                <button
                  key={routine.id}
                  type="button"
                  role="menuitem"
                  disabled={!opens}
                  data-routine-toggle-item={routine.id}
                  aria-label={opens ? t("chat.routineToggle.open", { name: routine.name }) : routine.name}
                  title={opens ? routine.name : t("chat.routineToggle.unavailable")}
                  onClick={() => {
                    setOpen(false);
                    onOpen(routine);
                  }}
                  className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink enabled:hover:bg-hover disabled:cursor-default disabled:text-ink-secondary"
                >
                  <Clock size={15} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                  <span className="min-w-0 flex-1 truncate">{routine.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** A routines row of the transcript, wired to the person's routines: a
 * routine opens on its page in its bot's panel when it is in their list. */
export function ConversationRoutineToggle({ message }: { message: Message }) {
  const { state, dispatch } = useStore();
  const event = message.routineToggle;
  if (!event) return null;
  const live = (routineId: string) => state.routines.find((routine) => routine.id === routineId);
  const canOpen = (routineId: string) => {
    const routine = live(routineId);
    return Boolean(routine?.botId && state.bots.some((bot) => bot.id === routine.botId && !bot.hidden));
  };
  const onOpen = (item: RoutineToggleEvent["routines"][number]) => {
    const routine = live(item.id);
    if (routine?.botId) dispatch({ type: "openRoutine", botId: routine.botId, routineId: routine.id });
  };
  if (isRoutineChangeAction(event.action)) {
    return <RoutineChangeLine event={event} canOpen={canOpen} onOpen={onOpen} />;
  }
  return <RoutineToggleLine event={event} canOpen={canOpen} onOpen={onOpen} />;
}
