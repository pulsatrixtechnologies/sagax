// Lot S1 (2026-11-17): the one rule that keeps a person's surface bot
// (server/temporary-agents.ts isSurfaceBot) and its conversations theirs.
// Every app route that names the bot, or one of its conversations, answers
// another person's session as an unknown bot, an organization admin's
// included. The member API reaches them through these same routes as the
// person (performAsMember), so it needs no check of its own.
//
// One exception, the existing rule for a server command of a member's bot:
// that card is an organization admin's to decide, so an admin answers it
// where it shows (the app's Today posts the conversation's respond route),
// and nothing else of the conversation.

export interface SurfaceAccessInput {
  /** The signed-in person, or null for the desktop and service loopback
   * (the paths a turn's own tools use). */
  session: { principalId: string; orgAdmin: boolean } | null;
  path: string;
  /** The surface bot a bot id or a conversation id belongs to, else null. */
  surfaceOf(kind: "bots" | "threads", id: string): { ownerPrincipalId: string | null } | null;
  /** A server command card an organization admin must decide is open in this conversation. */
  openAdminCard(threadId: string): boolean;
}

const NAMED = /^\/api\/(bots|threads)\/([\w-]{1,160})(\/.*)?$/;

/** Whether this request is refused as naming an unknown bot. */
export function surfaceTargetRefused(input: SurfaceAccessInput): boolean {
  if (!input.session) return false;
  const named = NAMED.exec(input.path);
  if (!named) return false;
  const kind = named[1] as "bots" | "threads";
  const surface = input.surfaceOf(kind, named[2]!);
  if (!surface) return false;
  if (input.session.principalId.trim().toLowerCase() === surface.ownerPrincipalId) return false;
  return !(kind === "threads" && named[3] === "/respond" && input.session.orgAdmin && input.openAdminCard(named[2]!));
}
