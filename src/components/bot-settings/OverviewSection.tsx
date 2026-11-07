// The bot settings dialog's Overview section: a plain-language read of a
// single bot, built entirely from server-generated sentences (BotOverview,
// server/bots/bot-overview.ts) so the phone app and this dialog never disagree
// about what a bot does. Pure presentational (no store, no fetch); the
// dialog owns loading, errors, and the section switch (onOpen).
import { useState } from "react";

import type { BotOverview } from "@/lib/bot-overview-types";
import { t } from "@/lib/i18n";
import type { BotSettingsSection } from "@/state/store";
import { PromptPreview, type PromptPreviewData } from "./PromptPreview";
import { ProfileLine } from "./ProfileRow";
import { GROUP_CARD, LinkRow, SettingsGroup, useSettingsSurface } from "../SettingsPrimitives";

export function OverviewSection({
  overview,
  refreshError,
  prompt,
  promptError,
  onOpen,
}: {
  overview: BotOverview | null;
  refreshError?: boolean;
  prompt: PromptPreviewData | null;
  promptError?: boolean;
  onOpen: (section: BotSettingsSection) => void;
}) {
  const [promptOpen, setPromptOpen] = useState(false);
  const plain = useSettingsSurface() === "plain";

  if (plain) {
    return <PlainOverview overview={overview} refreshError={refreshError} prompt={prompt} promptError={promptError} promptOpen={promptOpen} onTogglePrompt={() => setPromptOpen((current) => !current)} onOpen={onOpen} />;
  }

  if (!overview) {
    return <div className="text-[13px] text-ink-secondary">{t("botPanel.loading")}</div>;
  }

  // 2026-10-16 : drawn like Settings: each list under its grey
  // heading in one card, one line per row.
  const lines = (items: readonly string[], empty?: string) => items.length === 0
    ? empty ? <p className="px-3.5 py-2.5 text-[13px] leading-[18px] text-ink-secondary">{empty}</p> : null
    : (
      <ul className="flex flex-col">
        {items.map((line, i) => <li key={i} className="px-3.5 py-2 text-[13px] leading-[18px] text-ink">{line}</li>)}
      </ul>
    );

  return (
    <div className="flex flex-col gap-5">
      {refreshError && (
        <div className="rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink-secondary">
          {t("botPanel.overview.refresh")}
        </div>
      )}

      {(overview.who.blurb || overview.who.soulLead) && <div className={GROUP_CARD}>
        <div className="px-3.5 py-2">
          {overview.who.blurb && <p className="text-[13px] leading-relaxed text-ink">{overview.who.blurb}</p>}
          {overview.who.soulLead && (
            <div className={overview.who.blurb ? "mt-1.5" : undefined}>
              <p className="text-[13px] leading-relaxed text-ink-secondary">{overview.who.soulLead}</p>
            </div>
          )}
        </div>
        {overview.who.soulLead && <LinkRow label={t("botPanel.overview.readAll")} onClick={() => onOpen("soul")} rowId="readSoul" />}
      </div>}

      <SettingsGroup title={t("botPanel.overview.does")} groupId="overviewDoes">
        {lines(overview.does, t("botPanel.overview.nothingScheduled"))}
      </SettingsGroup>

      <SettingsGroup title={t("botPanel.overview.reach")} groupId="overviewReach">
        {lines(overview.reaches, t("botPanel.overview.nothingYet"))}
      </SettingsGroup>

      <SettingsGroup title={t("botPanel.overview.wont")} groupId="overviewWont">
        {lines(overview.wont)}
      </SettingsGroup>

      <PromptPreview
        data={prompt}
        error={promptError}
        open={promptOpen}
        onToggle={() => setPromptOpen((current) => !current)}
      />

    </div>
  );
}

/** The bot profile's "What it does" (2026-11-06): the profile's card look.
 * One card under the section's name holds who the bot is, "Read all" and
 * the prompt preview; Does, Can reach and Won't follow, each its own card
 * under its grey label, one sentence per row. The changes live in the
 * History tab. */
function PlainOverview({ overview, refreshError, prompt, promptError, promptOpen, onTogglePrompt, onOpen }: {
  overview: BotOverview | null;
  refreshError?: boolean;
  prompt: PromptPreviewData | null;
  promptError?: boolean;
  promptOpen: boolean;
  onTogglePrompt: () => void;
  onOpen: (section: BotSettingsSection) => void;
}) {
  const lines = (items: readonly string[], empty?: string) => items.length === 0
    ? empty ? <ProfileLine muted>{empty}</ProfileLine> : null
    : (
      <ul className="flex flex-col">
        {items.map((line, i) => <li key={i}><ProfileLine>{line}</ProfileLine></li>)}
      </ul>
    );

  return (
    <div className="flex flex-col gap-5" data-overview-plain="">
      <SettingsGroup title={t("persona.overview.summary")} groupId="overviewSummary">
        {!overview && <ProfileLine muted>{t("botPanel.loading")}</ProfileLine>}
        {refreshError && <p role="status" className="px-4 py-2.5 text-[12px] leading-4 text-ink-secondary">{t("botPanel.overview.refresh")}</p>}
        {overview?.who.blurb && <ProfileLine>{overview.who.blurb}</ProfileLine>}
        {overview?.who.soulLead && <p className="px-4 py-2.5 text-[13px] leading-[18px] text-ink-secondary">{overview.who.soulLead}</p>}
        {overview?.who.soulLead && <LinkRow label={t("botPanel.overview.readAll")} onClick={() => onOpen("soul")} rowId="readSoul" />}
        {overview && <PromptPreview data={prompt} error={promptError} open={promptOpen} onToggle={onTogglePrompt} />}
      </SettingsGroup>

      {overview && (
        <>
          <SettingsGroup title={t("botPanel.overview.does")} groupId="overviewDoes">
            {lines(overview.does, t("botPanel.overview.nothingScheduled"))}
          </SettingsGroup>
          <SettingsGroup title={t("botPanel.overview.reach")} groupId="overviewReach">
            {lines(overview.reaches, t("botPanel.overview.nothingYet"))}
          </SettingsGroup>
          <SettingsGroup title={t("botPanel.overview.wont")} groupId="overviewWont">
            {lines(overview.wont)}
          </SettingsGroup>
        </>
      )}
    </div>
  );
}
