import type { RefObject } from "react";
import { Users } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { mentionRowDescription } from "@/lib/mentions";
import { normalizeState } from "@/lib/mascot";
import { BotAvatar } from "../Avatar";
import { ComposerMenuRow } from "../ComposerMenuRow";
import type { MentionChoice } from "./types";

export function ComposerMentionMenu({
  listRef,
  className,
  exitProps,
  candidates,
  highlight,
  roomPeopleCount,
  mentionEveryoneCount,
  onPick,
  onHighlight,
}: {
  listRef: RefObject<HTMLDivElement | null>;
  className?: string;
  exitProps?: { inert?: boolean; "aria-hidden"?: boolean };
  candidates: MentionChoice[];
  highlight: number;
  roomPeopleCount: number;
  mentionEveryoneCount: number;
  onPick: (peer: MentionChoice) => void;
  onHighlight: (index: number) => void;
}) {
  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={t("composer.mention.aria")}
      className={cn("absolute bottom-full start-2 z-20 mb-2 max-h-72 w-72 overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border border-hairline/40 bg-raised shadow-lg", className)} {...exitProps}
    >
      {candidates.map((peer, i) => {
        const description = mentionRowDescription(peer.bot
          ? { kind: "bot", title: peer.bot.title }
          : peer.person
            ? { kind: "person" }
            : peer.all
              ? { kind: "all", count: roomPeopleCount }
              : { kind: "everyone", count: mentionEveryoneCount });
        return (
          <ComposerMenuRow
            key={peer.id}
            id={`composer-mention-${peer.id}`}
            data-mention-index={i}
            role="option"
            aria-selected={i === highlight}
            onClick={() => onPick(peer)}
            onMouseEnter={() => onHighlight(i)}
            selected={i === highlight}
            icon={peer.bot ? (
              <BotAvatar
                bot={peer.bot}
                state={normalizeState(peer.bot.mascotExpression) ?? "happy"}
                size={24}
              />
            ) : peer.person?.avatarUrl ? (
              <img src={peer.person.avatarUrl} alt="" className="size-6 rounded-full object-cover" />
            ) : (
              <span className="flex size-6 items-center justify-center rounded-full bg-raised text-ink-secondary">
                <Users size={14} aria-hidden="true" />
              </span>
            )}
            name={peer.name}
            description={description || undefined}
            kind={peer.bot ? t("composer.mention.agent") : peer.person ? t("composer.mention.person") : t("composer.mention.channel")}
          />
        );
      })}
    </div>
  );
}
