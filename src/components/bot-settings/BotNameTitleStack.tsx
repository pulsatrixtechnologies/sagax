// The bot's name and its title (label) at the top of the bot panel: the name
// on its own line, the title under it, smaller, secondary and centred.
// Never "Name · Title" on one line (JC, 2026-11-06, asked twice). Both stay
// editable where they show: a hover or focus shows the pencil, a click opens
// the field; nothing is highlighted at rest.
import type { MouseEvent } from "react";

import { t } from "@/lib/i18n";
import { BOT_PROFILE_LIMITS } from "../../../shared/bot-profile";
import { InlineEditableText } from "./InlineEditableText";
import { splitBotNameTitle } from "./bot-name-title";

export function BotNameTitleStack({
  name,
  title,
  onSaveName,
  onSaveTitle,
  renameRequest = 0,
  onContextMenu,
}: {
  name: string;
  title?: string;
  onSaveName?: (name: string) => void;
  onSaveTitle?: (title: string) => void;
  renameRequest?: number;
  onContextMenu?: (event: MouseEvent) => void;
}) {
  // a name stored with its title glued on shows on two lines too
  const shown = splitBotNameTitle(name, title);
  const shownTitle = shown.title;
  // saving one line of a glued name writes both fields back apart
  const saveName = onSaveName && ((next: string) => {
    onSaveName(next);
    if (shown.merged && !title?.trim()) onSaveTitle?.(shown.title);
  });
  const saveTitle = onSaveTitle && ((next: string) => {
    onSaveTitle(next);
    if (shown.merged) onSaveName?.(shown.name);
  });
  return (
    <div
      data-bot-name-title=""
      className="mt-5 flex w-full min-w-0 max-w-full flex-col items-center text-center"
      // the bot's menu on the name too, as on the mascot
      onContextMenu={onContextMenu}
    >
      <InlineEditableText
        id="bot-settings-title"
        value={shown.name}
        required
        maxLength={BOT_PROFILE_LIMITS.name}
        ariaLabel={t("botPanel.name.edit")}
        onSave={saveName}
        editRequest={renameRequest}
        className="min-w-0 shrink gap-0 px-0.5 text-[17px] font-medium leading-[22px] text-ink"
      />
      {shownTitle && (
        <div data-bot-title-line="" className="mt-0.5 flex min-w-0 max-w-full justify-center">
          <InlineEditableText
            value={shownTitle}
            maxLength={BOT_PROFILE_LIMITS.title}
            placeholder={t("botPanel.label.add")}
            ariaLabel={t("botPanel.label.edit")}
            onSave={saveTitle}
            className="min-w-0 shrink gap-0 px-0.5 text-[12.5px] font-normal leading-4 text-ink-secondary"
          />
        </div>
      )}
    </div>
  );
}
