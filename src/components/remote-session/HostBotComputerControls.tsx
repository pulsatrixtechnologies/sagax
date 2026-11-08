// The host row's bot computer parts (#2726, #2727): the ⋯ menu with "Use as
// a bot computer", "Edit tags" and each bot's isolated / as-is answer, and
// the tags shown (and edited inline) under the row's details. Saved on the
// server (PATCH /api/host-computers/:hostId). Same row menu as the bot
// panel's rows (ComputerCard). Items live in the row's shared ⋯ menu. No host id on screen.
import { useState } from "react";
import { Bot as BotIcon, Box, Check, Monitor, Tag } from "lucide-react";

import { cleanHostTags, type BotComputerHostMode, type BotComputerHostView } from "../../../shared/bot-computer-host";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { patchHostComputer } from "@/lib/host-computers";
import { useStoreOptional } from "@/state/store";
import { PageMenuItem } from "@/components/content-page";

/** The bot computer items of the host row's shared "⋯" menu (DeviceCardRow). */
export function HostBotComputerMenuItems({ hostId, host, close, onEditTags, onChanged }: {
  hostId: string;
  host: BotComputerHostView | null;
  close: () => void;
  onEditTags: () => void;
  onChanged: (next: BotComputerHostView | null) => void;
}) {
  const store = useStoreOptional();
  const botName = (botId: string) => store?.state.bots.find((bot) => bot.id === botId)?.name ?? t("hostComputer.aBot");
  const marked = host?.botComputer === true;
  const modes = Object.entries(host?.modes ?? {});
  const save = async (patch: Parameters<typeof patchHostComputer>[1]) => {
    close();
    onChanged(await patchHostComputer(hostId, patch).catch(() => null));
  };
  const check = <Check size={14} className="ml-auto shrink-0 text-ink-secondary" aria-hidden="true" />;
  return <>
    <PageMenuItem icon={BotIcon} data-host-bot-computer-toggle="" data-checked={marked ? "" : undefined}
      trailing={marked ? check : undefined} onClick={() => void save({ botComputer: !marked })}>{t("hostComputer.use")}</PageMenuItem>
    <PageMenuItem icon={Tag} data-host-bot-computer-tags="" onClick={() => { close(); onEditTags(); }}>{t("hostComputer.editTags")}</PageMenuItem>
    {modes.length > 0 && <div role="separator" className="my-1 h-px bg-hairline/50" />}
    {modes.map(([botId, mode]) => (
      <div key={botId} role="group" aria-label={botName(botId)} className="flex flex-col">
        <span className="truncate px-2 pt-1 text-[11.5px] leading-4 text-ink-tertiary">{botName(botId)}</span>
        {(["isolated", "as_is"] as const).map((value: BotComputerHostMode) => (
          <PageMenuItem key={value} icon={value === "isolated" ? Box : Monitor} data-host-bot-computer-mode={value}
            trailing={mode === value ? check : undefined}
            onClick={() => { if (mode !== value) void save({ mode: { botId, value } }); else close(); }}>
            {t(value === "isolated" ? "hostComputer.mode.isolated" : "hostComputer.mode.asIs")}
          </PageMenuItem>
        ))}
      </div>
    ))}
  </>;
}

/** The tags under the row's details, and their inline editor. */
export function HostBotComputerTags({ hostId, host, editing, onDone, onChanged }: {
  hostId: string;
  host: BotComputerHostView | null;
  editing: boolean;
  onDone: () => void;
  onChanged: (next: BotComputerHostView | null) => void;
}) {
  const tags = host?.tags ?? [];
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? tags.join(", ");
  const save = async () => {
    const next = cleanHostTags(value);
    setDraft(null);
    onDone();
    if (next.join(",") === tags.join(",")) return;
    onChanged(await patchHostComputer(hostId, { tags: next }).catch(() => null));
  };
  if (editing) {
    return (
      <div className="flex items-center gap-1.5 pl-12" data-host-bot-computer-tag-editor="">
        <input type="text" autoFocus value={value} maxLength={400}
          aria-label={t("hostComputer.editTags")} placeholder={t("hostComputer.tagsPlaceholder")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); void save(); }
            if (event.key === "Escape") { event.preventDefault(); setDraft(null); onDone(); }
          }}
          onBlur={() => void save()}
          className="h-8 min-w-0 flex-1 rounded-lg border border-hairline/50 bg-raised px-2 text-[12.5px] text-ink" />
      </div>
    );
  }
  if (!host?.botComputer && tags.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-12" data-host-bot-computer-row-tags="">
      {host?.botComputer && (
        <span data-host-bot-computer-badge="" className="inline-flex h-6 items-center gap-1 rounded-full bg-selected px-2 text-[11.5px] font-medium text-ink">
          <BotIcon size={12} aria-hidden="true" />{t("hostComputer.badge")}
        </span>
      )}
      {tags.map((tag) => (
        <span key={tag} data-host-bot-computer-tag={tag} className={cn("inline-flex h-6 items-center rounded-full border border-hairline/50 px-2 text-[11.5px] text-ink-secondary")}>{tag}</span>
      ))}
    </div>
  );
}
