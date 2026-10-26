// Who shared a bot with the viewer: the person a bot row wears on its avatar
// (the same face Browse Bots draws as the creator badge). Only a person the
// organization directory exposes to this viewer is named; an owner it does
// not list, the viewer's own bot and a local bot have none.
import { personInitials } from "@/lib/people-dm";
import { personLabel } from "@/lib/human-label";
import { personAvatarSrc } from "@/lib/profile-management";
import type { OrgDirectoryPerson } from "@/lib/perspicax-org";

export interface BotSharer {
  principalId: string;
  name: string;
  initials: string;
  avatarUrl?: string;
}

export function botSharer(
  bot: { ownerUserId?: string },
  viewerId: string,
  people: ReadonlyMap<string, OrgDirectoryPerson>,
): BotSharer | null {
  const owner = bot.ownerUserId?.trim().toLowerCase();
  if (!owner || owner === "local-owner" || owner === viewerId.trim().toLowerCase()) return null;
  const person = people.get(owner);
  if (!person) return null;
  const name = personLabel(person.name, person.login, owner);
  const avatarUrl = personAvatarSrc(person.avatarUrl);
  return { principalId: owner, name, initials: personInitials(name), ...(avatarUrl ? { avatarUrl } : {}) };
}
