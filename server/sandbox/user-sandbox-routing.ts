// Where a bot's shell, file and browser tools run (organization mode).
//
//   user-desktop  the person's own computer, when the turn targets it
//                 (routed by the desktop work, not here)
//   user-sandbox  the person's server environment: one isolated container
//                 per PERSON on the server, shared by all their bots
//   host          a solo server's own machine (unchanged)
//   none          an organization server with no provisioner configured:
//                 nothing is mounted rather than falling back to the host
//
// An organization server never answers "host": the Sagax server container is
// not anyone's computer.
export type ExecutionTarget = "user-desktop" | "user-sandbox" | "host" | "none";

export function resolveExecutionTarget(input: {
  organization: boolean;
  sandboxConfigured: boolean;
  /** The turn's place is the person's own desktop. */
  desktopTargeted: boolean;
}): ExecutionTarget {
  if (!input.organization) return "host";
  if (input.desktopTargeted) return "user-desktop";
  return input.sandboxConfigured ? "user-sandbox" : "none";
}

/** Whose environment a turn uses. There is deliberately no bot id in this
 * signature: a per-bot environment cannot be expressed.
 *
 * - A conversation runs in the SPEAKER's environment (the person talking,
 *   or the person a bot hop speaks for): a teammate's files and commands
 *   never land in the bot owner's environment, and the speaker's own work
 *   follows them across every bot they use. Private threads stay private.
 * - A routine, and every thread or hop a routine starts, runs in the bot
 *   OWNER's environment (routines run as the bot owner).
 * - A room turn runs in the environment of the person whose message it
 *   answers (the latest person who spoke in the room). A follow-up no person
 *   ever asked for falls back to the room's creator. A bot's follow-up after
 *   a person's message keeps that person's environment: the work they asked
 *   for, and their files, stay together instead of moving to the creator's.
 * - A confidential thread (server/confidential-threads.ts) always works in
 *   its OWNER's environment, whoever or whatever started the turn.
 * - Null when nobody is known: nothing is mounted (fail closed). */
export function sandboxPrincipalForTurn(input: {
  botOwnerPrincipalId: string;
  /** A confidential thread's owner: wins over everything else. */
  confidentialOwnerPrincipalId?: string | null;
  /** The turn belongs to a routine (directly or through hops). */
  routine: boolean;
  /** The person this turn speaks for, "" or absent when unknown. */
  speakerPrincipalId?: string;
  /** Rooms only: who created the room. */
  roomCreatorPrincipalId?: string;
}): string | null {
  if (input.confidentialOwnerPrincipalId) return input.confidentialOwnerPrincipalId;
  if (input.routine) return input.botOwnerPrincipalId || null;
  if (input.speakerPrincipalId) return input.speakerPrincipalId;
  return input.roomCreatorPrincipalId || null;
}

/** The MCP server name the environment tools are mounted under. The UI reads
 * it back from tool names to show where a tool ran. */
export const USER_SANDBOX_MCP_NAME = "sagax-environment";

/** Whether this turn attaches a Boat, a VPS, or a shared team computer.
 * An organization server never does. Cloud, a cloud routine and a room all
 * use the person's one server environment. A team computer does not open a
 * shared machine there. A cloud routine still forces the Cloud place, which
 * on an organization server is that environment. Solo still forces Cloud
 * for a cloud routine or an inherited team computer. */
export function remoteComputerForTurn(input: {
  organization: boolean;
  runOnCloud: boolean;
  hasTeamComputer: boolean;
}): { skipRemote: boolean; forceCloud: boolean } {
  if (input.organization) return { skipRemote: true, forceCloud: input.runOnCloud };
  return { skipRemote: false, forceCloud: input.runOnCloud || input.hasTeamComputer };
}

/** A screen of a person's cloud computer on an organization server reaches
 * that person only, and only while the turn still names them. Anyone else,
 * including an admin, gets nothing. Solo servers are unchanged. */
export function screenVisibleToPrincipal(input: {
  organization: boolean;
  viewerId?: string;
  workplacePrincipal?: string;
}): boolean {
  if (!input.organization) return true;
  const viewer = input.viewerId?.trim().toLowerCase() ?? "";
  const principal = input.workplacePrincipal?.trim().toLowerCase() ?? "";
  return viewer.length > 0 && viewer === principal;
}
