import type { ReactNode } from "react";
import { Pause } from "lucide-react";
import { t } from "@/lib/i18n";
import type { Bot, Group } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { PlaceIcon } from "../PlaceIcon";
import { effectivePlace, placeLabelKey } from "@/lib/place";
import { PersonAvatar } from "../MessageAuthor";
import { PersonLabelTag } from "../LabelTag";
import { GroupAvatarStack } from "../GroupPanel";
import { BotHeaderPill } from "../BotHeaderPill";
import { normalizeState } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { peopleDmPeer } from "@/lib/people-dm";

type Peer = NonNullable<ReturnType<typeof peopleDmPeer>>;

/** Member face stack for a DM header, and the centered room / person pill. */
export function groupRoomIdentity({
  group,
  members,
  peer,
  panelOpen,
  personPanelId,
  onTogglePanel,
  onOpenPerson,
  speakersElsewhere,
}: {
  group: Group;
  members: Bot[];
  peer: Peer | null | undefined;
  panelOpen: boolean;
  personPanelId: string | null | undefined;
  onTogglePanel: () => void;
  onOpenPerson: (personId: string | null) => void;
  /** Members working in another thread of this room. */
  speakersElsewhere?: ReadonlySet<string>;
}): { memberMauses: ReactNode; groupPill: ReactNode } {
  const elsewhere = speakersElsewhere ?? new Set<string>();
  const memberMauses = members.map((b) => {
    const busy = group.busyBotId === b.id;
    const busyElsewhere = !busy && elsewhere.has(b.id);
    const held = !group.dm && Boolean(group.holds?.[b.id]);
    const task = b.tasks?.find((candidate) => candidate.threadId === group.threadId);
    const effective = busy ? effectivePlace(b, task) : "off";
    const showPlace = busy && effective !== "off" && effective !== "auto";
    return (
      <span
        key={b.id}
        data-held={held || undefined}
        title={
          held
            ? t("room.holds.avatarHeld", { name: b.name })
            : busyElsewhere
              ? t("room.memberWorkingElsewhere", { name: b.name })
              : `${b.name}${busy ? " — working…" : ""}`
        }
        className={cn(
          "relative inline-flex rounded-full",
          busy && "ring-2 ring-accent/50 ring-offset-1 ring-offset-app",
          busyElsewhere && "ring-1 ring-hairline ring-offset-1 ring-offset-app",
        )}
      >
        <span className={cn("inline-flex", held && "opacity-50 grayscale")}>
          <BotAvatar bot={b} state={normalizeState(b.mascotExpression) ?? "happy"} size={24} animated={false} />
        </span>
        {held && !busy && (
          <span
            className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full border border-app bg-raised text-ink-secondary"
            role="img"
            aria-label={t("room.holds.avatarHeld", { name: b.name })}
          >
            <Pause size={8} strokeWidth={3} aria-hidden="true" />
          </span>
        )}
        {busy && (
          showPlace ? (
            <span
              className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full border border-app bg-accent text-white"
              role="img"
              aria-label={t("place.chipAria", { place: t(placeLabelKey(effective)) })}
            >
              <PlaceIcon place={effective} size={9} strokeWidth={2.5} aria-hidden="true" />
            </span>
          ) : (
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full border border-app bg-accent" />
          )
        )}
      </span>
    );
  });

  const groupPill = (peer ? (
    // A person: their name opens their panel, the way a bot's does.
    <button
      type="button"
      data-open-person={peer.id}
      onClick={() => onOpenPerson(personPanelId === peer.id ? null : peer.id)}
      className="flex min-w-0 items-center gap-2 rounded-full border-[0.5px] border-hairline-weak bg-elevated py-[7.5px] pl-[7.5px] pr-[13.5px] transition-colors duration-[120ms] hover:bg-elevated-hover"
      title={t("personPanel.open", { name: peer.name })}
      aria-label={t("personPanel.open", { name: peer.name })}
    >
      <PersonAvatar avatarUrl={peer.avatarUrl} initials={peer.initials} size={24} presenceId={peer.id} presenceRing="border-elevated" />
      <span className="truncate text-[14px] font-medium leading-5 text-ink">{peer.name}</span>
      <PersonLabelTag principalId={peer.id} tone="surface" className="max-w-[40%] shrink" />
    </button>
  ) : group.dm ? (
    <span className="flex min-w-0 items-center gap-2 rounded-full border-[0.5px] border-hairline-weak bg-elevated py-[7.5px] pl-[7.5px] pr-[13.5px]">
      <GroupAvatarStack members={members} size={24} />
      <span title={group.name} className="min-w-0 truncate whitespace-nowrap text-[14px] font-medium leading-5 text-ink">{group.name}</span>
    </span>
  ) : (
    // The bot chat's pill (member faces, name, chevron): it opens
    // the group panel, a split-view section's at the right edge too.
    <BotHeaderPill
      name={group.name}
      panelOpen={panelOpen}
      onToggle={onTogglePanel}
      avatar={<GroupAvatarStack members={members} size={24} />}
    />
  ));

  return { memberMauses, groupPill };
}
