// The host row's bot computer parts (#2726, #2727): the ⋯ menu's "Use as
// a bot computer" and "Edit tags", and the tags shown (and edited inline)
// under the row's details. Saved on the server (PATCH
// /api/host-computers/:hostId). Same row menu as the bot panel's rows
// (ComputerCard). No host id on screen. #4327: each bot's isolated / as-is
// answer left this menu for the "Bots…" window (HostBotEnvironments), the
// one place for which bots use this computer and how.
import { useState } from "react";
import { Bot as BotIcon, Check, Tag } from "lucide-react";

import { cleanHostTags, type BotComputerHostView } from "../../../shared/bot-computer-host";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { patchHostComputer } from "@/lib/host-computers";
import { PageMenuItem } from "@/components/content-page";
import { DEVICE_CHIP } from "./DeviceCardRow";

/** The bot computer items of the host row's shared "⋯" menu (DeviceCardRow). */
export function HostBotComputerMenuItems({ hostId, host, close, onEditTags, onChanged }: {
  hostId: string;
  host: BotComputerHostView | null;
  close: () => void;
  onEditTags: () => void;
  onChanged: (next: BotComputerHostView | null) => void;
}) {
  const marked = host?.botComputer === true;
  const save = async (patch: Parameters<typeof patchHostComputer>[1]) => {
    close();
    onChanged(await patchHostComputer(hostId, patch).catch(() => null));
  };
  const check = <Check size={14} className="ml-auto shrink-0 text-ink-secondary" aria-hidden="true" />;
  return <>
    <PageMenuItem icon={BotIcon} data-host-bot-computer-toggle="" data-checked={marked ? "" : undefined}
      trailing={marked ? check : undefined} onClick={() => void save({ botComputer: !marked })}>{t("hostComputer.use")}</PageMenuItem>
    <PageMenuItem icon={Tag} data-host-bot-computer-tags="" onClick={() => { close(); onEditTags(); }}>{t("hostComputer.editTags")}</PageMenuItem>
  </>;
}

/** The inline editor of the host's tags (the chips are HostBotComputerChips). */
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
  return null;
}

/** #3134: "Bot computer" and the host's tags as chips on the card's own
 * line, so the card keeps its height; every tag is also under Details. */
export function HostBotComputerChips({ host }: { host: BotComputerHostView | null }) {
  const tags = host?.tags ?? [];
  if (!host?.botComputer && tags.length === 0) return null;
  return (
    <>
      {host?.botComputer && (
        <span data-host-bot-computer-badge="" className={cn(DEVICE_CHIP, "border-transparent bg-selected font-medium text-ink")}>
          <BotIcon size={11} aria-hidden="true" className="shrink-0" /><span className="truncate">{t("hostComputer.badge")}</span>
        </span>
      )}
      {tags.map((tag) => (
        <span key={tag} data-host-bot-computer-tag={tag} title={tag} className={DEVICE_CHIP}><span className="truncate">{tag}</span></span>
      ))}
    </>
  );
}
