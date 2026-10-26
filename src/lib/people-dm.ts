// A direct conversation between two people (server/people-dms.ts) as the app
// shows it: under the other person's name and avatar, from the directory.
import type { OrgDirectoryPerson } from "@/lib/perspicax-org";
import { personAvatarSrc } from "@/lib/profile-management";
import { personLabel } from "@/lib/human-label";

/** Two letters for a person without a picture. */
export function personInitials(label: string): string {
  const parts = label.trim().split(/[\s@._-]+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return (letters || label.slice(0, 2)).toUpperCase();
}

/** The other person of a people-only conversation, for the viewer: their
 * directory name and avatar, else the id the conversation stores. */
export function peopleDmPeer(
  group: { peopleDm?: boolean; humanIds?: string[]; name: string },
  viewer: string,
  people: ReadonlyMap<string, OrgDirectoryPerson>,
): { id: string; name: string; initials: string; avatarUrl?: string } | null {
  if (!group.peopleDm) return null;
  const self = viewer.trim().toLowerCase();
  const id = (group.humanIds ?? []).find((entry) => entry.trim().toLowerCase() !== self) ?? group.humanIds?.[0];
  if (!id) return null;
  const person = people.get(id.trim().toLowerCase());
  const name = personLabel(person?.name, person?.login, group.name, id);
  const avatarUrl = personAvatarSrc(person?.avatarUrl);
  return { id, name, initials: personInitials(name), ...(avatarUrl ? { avatarUrl } : {}) };
}
