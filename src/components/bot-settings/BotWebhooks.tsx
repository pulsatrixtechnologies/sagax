// Persona > Access > Webhooks (2026-10-29): this bot's webhooks, listed
// only. A routine's webhook is managed in that routine (its page and its
// editor, RoutineWebhookPanel): each row opens it. A webhook of its own is
// managed in Automations > Webhooks. Edit bot keeps no second copy.
import { ExternalLink } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { viewerOwnsBot } from "@/lib/bot-capabilities";
import { viewerBotsReadOnly } from "@/lib/viewer";
import { statusFor } from "../WebhooksPanel";
import { PILL } from "../SettingsPrimitives";
import { PaneEmpty, PaneSection, usePaneRows } from "./PaneSection";

/** The bot's owner manages its webhooks: solo, an admin or the owner. */
export function canManageBotWebhooks(config: Parameters<typeof viewerOwnsBot>[0], bot: Pick<Bot, "ownerUserId">): boolean {
  return !viewerBotsReadOnly(config) && viewerOwnsBot(config, bot);
}

export function BotWebhooks({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const webhooks = state.webhooks.filter((webhook) => webhook.botId === bot.id);
  const routines = state.routines ?? [];
  // The bot's profile page (#2313): reference rows and a pill to open each.
  const rows = usePaneRows();

  return (
    <PaneSection data-bot-webhooks="" title={t("botPanel.access.webhooks")} help={t("botWebhooks.listHelp")}>
      {webhooks.length === 0 ? (
        <PaneEmpty>{t("botPanel.access.noWebhooks")}</PaneEmpty>
      ) : (
        <ul className={cn(rows.bleed, "-my-1", rows.list)}>
          {webhooks.map((webhook) => {
            const status = statusFor(webhook);
            const routine = webhook.routineId ? routines.find((candidate) => candidate.id === webhook.routineId) : undefined;
            return (
              <li key={webhook.id} data-bot-webhook={webhook.id} className={cn("flex items-center gap-2 py-2", rows.plain && "min-h-[44px]", rows.row)}>
                <span className={cn("min-w-0 flex-1 truncate text-ink", rows.title)}>{routine?.name ?? webhook.name}</span>
                <span className={cn("flex shrink-0 items-center gap-1.5", rows.note, status.tone)}>
                  <span className={cn("size-1.5 rounded-full", status.dot)} aria-hidden="true" />
                  {status.label}
                </span>
                <span className={cn("shrink-0 tabular-nums text-ink-secondary", rows.note)}>
                  {t("botPanel.access.deliveries", { count: String(webhook.deliveryCount) })}
                </span>
                <button
                  type="button"
                  data-open-webhook-home={routine ? "routine" : "automations"}
                  onClick={() => dispatch(routine
                    ? { type: "openRoutine", botId: routine.botId, routineId: routine.id }
                    : { type: "showRoutines", section: "webhooks" })}
                  className={rows.plain ? cn(PILL, "shrink-0 gap-1") : "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium text-accent-text hover:bg-raised"}
                >
                  {routine ? t("botWebhooks.openRoutine") : t("botWebhooks.openAutomations")}
                  <ExternalLink size={12} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </PaneSection>
  );
}
