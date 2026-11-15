// #4360: whether the person signed in is alone on their server, the one test
// every surface that speaks of other people (reports, blocking, admins,
// invitations) reads. Built from what the server already answers, no flag:
// - an organization server (the Perspicax probe, src/lib/perspicax-org.ts)
//   is never alone;
// - a person who does not run the server (not its owner or an admin) was let
//   in by someone else, so is not alone;
// - the server's sign-in directory (GET /api/org/invites, owner or admin):
//   alone while it lists the owner only and no invitation waits; a server
//   with no directory at all (404) has nobody else to sign in.
// Any other answer (an older server, a network failure) keeps the wording of
// a server with people, as before.
import { useEffect, useState } from "react";
import { api, ApiError } from "@/state/store";
import { useStoreSelector } from "@/state/store-selector";
import { viewerIsOrgAdmin } from "@/lib/group-owner";
import { loadPerspicaxOrg } from "@/lib/perspicax-org";

/** The part of GET /api/org/invites the test reads. */
export interface ServerDirectory {
  people: readonly unknown[];
  pendingInvites: readonly unknown[];
}

/** The rule itself: only the owner listed, and no invitation waiting. */
export function directoryAlone(directory: ServerDirectory): boolean {
  return directory.people.length <= 1 && directory.pendingInvites.length === 0;
}

let known: boolean | null = null;

/** Asks the server; `admin` is whether the viewer runs it (owner or admin). */
export async function loadServerAlone(admin: boolean): Promise<boolean> {
  const org = await loadPerspicaxOrg();
  let alone = false;
  if (org === null && admin) {
    try {
      const body = await api<Partial<ServerDirectory>>("/api/org/invites");
      alone = directoryAlone({ people: body.people ?? [], pendingInvites: body.pendingInvites ?? [] });
    } catch (failure) {
      alone = failure instanceof ApiError && failure.status === 404;
    }
  }
  known = alone;
  return alone;
}

/** The last answer this page read, or null before the first one. */
export function knownServerAlone(): boolean | null {
  return known;
}

/** For tests: forget the last answer. */
export function resetServerAlone(): void {
  known = null;
}

/** Whether the viewer is alone on their server. Starts from the last answer
 * this page read (false before any: the wording of a server with people) and
 * asks again on mount. */
export function useServerAlone(): boolean {
  const admin = useStoreSelector((current) => viewerIsOrgAdmin(current.config));
  const [alone, setAlone] = useState(() => known ?? false);
  useEffect(() => {
    let alive = true;
    void loadServerAlone(admin).then((value) => { if (alive) setAlone(value); });
    return () => { alive = false; };
  }, [admin]);
  return alone;
}
