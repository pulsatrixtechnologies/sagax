// The nearly-full-context warning and its "Compact now", for a bot's 1:1
// header and for a room's roster (lib/context-warning.ts says where the
// readings come from). Both buttons call the compaction the server already
// has: a 1:1 thread's POST /api/bots/:id/compact (a summary of older
// exchanges, history kept), and a room member's
// POST /api/groups/:id/members/:botId/compact (its next turn in the room
// starts on a fresh session with the room's recent messages).
import { useState } from "react";
import { Gauge } from "lucide-react";

import { cn } from "@/lib/cn";
import { roomContextWarnings, threadContextWarning } from "@/lib/context-warning";
import { t } from "@/lib/i18n";
import { api, useStore, type Bot, type Group, type Message } from "@/state/store";

const pill = "flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-[12.5px] text-ink";
const action = "rounded-full px-1.5 font-medium text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline";

/** One request at a time per control; a failure lands in the chat's error banner. */
function useCompact() {
  const { dispatch } = useStore();
  const [pending, setPending] = useState(false);
  const run = (path: string, body: unknown) => {
    if (pending) return;
    setPending(true);
    void api(path, { method: "POST", body: JSON.stringify(body) })
      .catch((cause) => dispatch({ type: "error", message: cause instanceof Error ? cause.message : String(cause) }))
      .finally(() => setPending(false));
  };
  return { pending, run };
}

/** Pure markup for the 1:1 header, for tests. */
export function ThreadContextWarningView({ name, percent, busy, pending, onCompact }: {
  name: string; percent: number; busy: boolean; pending: boolean; onCompact: () => void;
}) {
  return (
    <span role="status" data-testid="context-warning" className={pill}
      title={t("contextWarning.threadHint", { name, percent })}>
      <Gauge size={13} className="shrink-0 text-warning" aria-hidden="true" />
      <span className="tabular-nums">{t("contextWarning.short", { percent })}</span>
      <button type="button" className={action} disabled={busy || pending} onClick={onCompact}
        title={busy ? t("contextWarning.busy") : undefined}>
        {pending ? t("contextWarning.compacting") : t("contextWarning.compactNow")}
      </button>
    </span>
  );
}

/** Beside the 1:1 header's controls while the thread's context is at 80% or more. */
export function ThreadContextWarning({ bot, messages }: { bot: Bot; messages: readonly Message[] }) {
  const usage = bot.tasks?.find((task) => task.threadId === bot.threadId)?.usage;
  const warning = threadContextWarning(usage, messages);
  const { pending, run } = useCompact();
  if (!warning) return null;
  return (
    <ThreadContextWarningView name={bot.name} percent={warning.percent} busy={Boolean(bot.busy)} pending={pending}
      onCompact={() => run(`/api/bots/${bot.id}/compact`, { threadId: bot.threadId })} />
  );
}

/** The roster avatar's mark for a member at 80% or more in this room. */
export function RoomContextBadge({ percent }: { percent: number }) {
  return (
    <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border border-app bg-warning"
      role="img" aria-label={t("contextWarning.short", { percent })} />
  );
}

/** Pure markup for the room strip, for tests. */
export function RoomContextWarningsView({ warnings, pendingBotId, onCompact }: {
  warnings: ReturnType<typeof roomContextWarnings>;
  pendingBotId: string | null;
  onCompact: (botId: string) => void;
}) {
  if (!warnings.length) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="room-context-warnings">
      {warnings.map(({ bot, percent, requested }) => (
        <p key={bot.id} role="status" className={cn(pill, "w-fit")}>
          <Gauge size={13} className="shrink-0 text-warning" aria-hidden="true" />
          <span>{t("contextWarning.room", { name: bot.name, percent })}</span>
          {requested
            ? <span className="text-ink-secondary">{t("contextWarning.roomRequested")}</span>
            : <button type="button" className={action} disabled={pendingBotId === bot.id} onClick={() => onCompact(bot.id)}
              title={t("contextWarning.roomHint")}>
              {pendingBotId === bot.id ? t("contextWarning.compacting") : t("contextWarning.compactNow")}
            </button>}
        </p>
      ))}
    </div>
  );
}

/** Under a room's header: each member at 80% or more of its context here. */
export function RoomContextWarnings({ group, members }: { group: Group; members: readonly Bot[] }) {
  const warnings = roomContextWarnings(group, members);
  const { pending, run } = useCompact();
  const [target, setTarget] = useState<string | null>(null);
  if (!warnings.length) return null;
  return (
    <div className="w-full px-5 pb-1">
      <RoomContextWarningsView warnings={warnings} pendingBotId={pending ? target : null} onCompact={(botId) => {
        setTarget(botId);
        run(`/api/groups/${group.id}/members/${botId}/compact`, {});
      }} />
    </div>
  );
}
