// The bot editor's Profile header: the mascot (Appearance on click), name,
// label and short description edited in place, and a summary of the engine,
// model, owner and sharing. The bot's actions (Rename, Put on the desktop,
// Make primary bot, Export, Archive) are in the bot's "..." menu in the bot
// panel (bot-settings/BotActionsMenu.tsx). Every write goes through the
// existing paths: the bot patch queue.
import { type ReactNode } from "react";
import { Star } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { engineLabel, personLabel } from "@/lib/human-label";
import { canEditBotField, showBotRename } from "@/lib/bot-capabilities";
import { isViewersPrimaryBot, viewerOwnsBot } from "@/lib/primary-bot";
import { viewerActorId } from "@/lib/viewer";
import { botEngine } from "@/lib/failed-turn";
import { useOrgPeople } from "@/lib/perspicax-org";
import { BOT_PROFILE_LIMITS } from "../../../shared/bot-profile";
import { BotProfileAvatarCard } from "../BotProfileAvatarCard";
import { InlineEditableText } from "../bot-settings/InlineEditableText";
import { CompactRow, SettingsGroup } from "../SettingsPrimitives";
import type { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";

/** "Model" in the summary: Auto, or the engine's label for the model, with
 * the effort when one is set. */
export function personaModelSummary(bot: Bot, engine: ReturnType<typeof botEngine>): string {
  if (bot.modelSelection.auto) return t("persona.overview.modelAuto");
  const label = engine?.models.options.find((option) => option.id === bot.modelSelection.model)?.label ?? bot.modelSelection.model;
  return bot.modelSelection.effort ? `${label} · ${bot.modelSelection.effort}` : label;
}

/** "Sharing" in the summary: the grants when there are any, else who may
 * see it, else not shared. */
export function personaSharingSummary(bot: Bot): string {
  const grants = bot.grants?.length ?? bot.directGrants?.length ?? 0;
  if (grants > 0) return t("persona.overview.sharedCount", { count: String(grants) });
  if (bot.visibility === "everyone") return t("botSettings.visibility.everyone");
  if (bot.visibility === "admins") return t("botSettings.visibility.admins");
  if (bot.visibility && typeof bot.visibility === "object") return t("botSettings.visibility.people");
  return t("botSettings.sharing.empty");
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <CompactRow label={label}>
      <span className="min-w-0 max-w-[260px] truncate text-[13px] leading-[18px] text-ink-secondary">{children}</span>
    </CompactRow>
  );
}

export function PersonaOverview({ bot, derived }: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
}) {
  const { state } = useStore();
  const people = useOrgPeople();
  const viewerId = viewerActorId(state.config);
  const engine = botEngine(bot, state.instances);
  const canRename = showBotRename(state.config, bot);
  const canDescribe = canEditBotField(state.config, bot, "description");
  const isPrimary = isViewersPrimaryBot(bot, viewerId);
  const owner = viewerOwnsBot(bot, viewerId)
    ? t("persona.overview.ownerYou")
    : (() => {
      const person = people.get(bot.ownerUserId?.trim().toLowerCase() ?? "");
      return bot.ownerUserId ? personLabel(person?.name, person?.login, bot.ownerUserId) : "";
    })();

  return (
    <div className="flex flex-col gap-5" data-persona-overview="">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="-mt-6 shrink-0">
          <BotProfileAvatarCard bot={bot} activeState={derived.activeState} mascotMotion={derived.mascotMotion} onPatch={derived.patch} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1 sm:items-start sm:pt-4">
          <InlineEditableText
            value={bot.name}
            required
            maxLength={BOT_PROFILE_LIMITS.name}
            ariaLabel={t("botPanel.name.edit")}
            onSave={canRename ? (name) => derived.patch({ name }) : undefined}
            className="text-[19px] font-semibold leading-7 text-ink"
          />
          <InlineEditableText
            value={bot.title}
            maxLength={BOT_PROFILE_LIMITS.title}
            placeholder={t("botPanel.label.add")}
            ariaLabel={t("botPanel.label.edit")}
            onSave={canEditBotField(state.config, bot, "title") ? (title) => derived.patch({ title }) : undefined}
            muted
            className="text-[13px] leading-5"
          />
          {isPrimary && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-[11.5px] text-ink-secondary">
              <Star size={11} aria-hidden="true" className="text-accent" /> {t("primaryBot.badge")}
            </span>
          )}
        </div>
      </div>

      {/* Settings' layout (2026-10-16): grey headings outside the cards,
          the summary as compact rows (label at the left, value at the right). */}
      <section className="flex flex-col gap-2" data-persona-description="">
        <label htmlFor={`persona-description-${bot.id}`} className="px-1 text-[13px] leading-[18px] text-ink-secondary">{t("persona.overview.description")}</label>
        {canDescribe ? (
          <textarea
            id={`persona-description-${bot.id}`}
            className="min-h-[72px] w-full resize-y rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-2.5 text-[13px] leading-relaxed text-ink placeholder:text-ink-secondary focus:border-focus focus:outline-none"
            maxLength={BOT_PROFILE_LIMITS.description}
            placeholder={t("botPanel.identity.blurbPlaceholder")}
            value={bot.description}
            onChange={(event) => derived.patch({ description: event.target.value })}
          />
        ) : (
          <p id={`persona-description-${bot.id}`} className="rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
            {bot.description.trim() || <span className="text-ink-secondary">{t("persona.overview.noDescription")}</span>}
          </p>
        )}
      </section>

      <SettingsGroup title={t("persona.overview.summaryTitle")} groupId="personaSummary">
        <Fact label={t("persona.overview.engine")}>{engineLabel(engine?.displayName, bot.modelSelection.instanceId)}</Fact>
        <Fact label={t("persona.overview.model")}>{personaModelSummary(bot, engine)}</Fact>
        <Fact label={t("persona.overview.owner")}>{owner}</Fact>
        <Fact label={t("persona.overview.sharing")}>{personaSharingSummary(bot)}</Fact>
      </SettingsGroup>

    </div>
  );
}
