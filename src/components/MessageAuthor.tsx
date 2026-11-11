// The name above a person's line when someone else wrote it: another member
// of the channel, or the operator seen from a member's session. Your own
// lines carry no name, as before.
import { otherAuthorName } from "@/lib/viewer";
import { InitialsAvatar } from "./Avatar";
import { WithPresence } from "./PresenceDot";
import type { Message } from "@/state/store";
import { useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import { t } from "@/lib/i18n";

export function OtherAuthorLabel({ message }: { message: Pick<Message, "role" | "sender"> }) {
  // the name only: every bubble holds one, and another bot's frame renders none (#3624)
  const dispatch = useStoreDispatch();
  const name = useStoreSelector((current) => otherAuthorName(message, current.config));
  if (!name) return null;
  const personId = message.sender?.id?.trim();
  if (personId) {
    return (
      <button
        type="button"
        data-open-person={personId}
        onClick={() => dispatch({ type: "openPersonPanel", personId })}
        title={t("personPanel.open", { name })}
        className="mb-1 mr-1.5 max-w-[80%] truncate text-[12px] leading-4 text-ink-secondary hover:text-ink hover:underline"
      >
        {name}
      </button>
    );
  }
  return <div className="mb-1 mr-1.5 max-w-[80%] truncate text-[12px] leading-4 text-ink-secondary">{name}</div>;
}

/** A person's round avatar: their Perspicax picture when this server serves
 * one, else their initials (the same look as the group's people list). With
 * `presenceId`, their online / away / offline dot on its corner, ringed in
 * `presenceRing` (the surface behind the avatar). */
export function PersonAvatar({ avatarUrl, initials, size = 20, presenceId, presenceRing }: { avatarUrl?: string; initials: string; size?: number; presenceId?: string | null; presenceRing?: string }) {
  const face = avatarUrl ? (
    <img src={avatarUrl} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <InitialsAvatar initials={initials} size={size} />
  );
  if (!presenceId) return face;
  return <WithPresence principalId={presenceId} avatarSize={size} ringClassName={presenceRing}>{face}</WithPresence>;
}

/** Above the first line of another person's run in a group: avatar and name.
 * With `onOpen` (a person of the directory), both open their panel. */
export function RoomPersonLabel({ name, initials, avatarUrl, personId, onOpen }: { name: string; initials: string; avatarUrl?: string; personId?: string; onOpen?: (personId: string) => void }) {
  const face = (
    <>
      <PersonAvatar avatarUrl={avatarUrl} initials={initials} />
      <span className="max-w-[60vw] truncate text-[12px] font-medium leading-4 text-ink-secondary">{name}</span>
    </>
  );
  return (
    <div data-testid="room-person" className="-mb-1.5 ms-1.5 mt-3 flex items-center gap-1.5 px-1.5">
      {personId && onOpen ? (
        <button
          type="button"
          data-open-person={personId}
          onClick={() => onOpen(personId)}
          title={t("personPanel.open", { name })}
          className="flex min-w-0 items-center gap-1.5 rounded-md hover:[&>span]:text-ink hover:[&>span]:underline"
        >
          {face}
        </button>
      ) : face}
    </div>
  );
}
