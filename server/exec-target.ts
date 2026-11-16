// Where a member bot's commands, code and actions run on an organization
// server, and who may target the shared server (2026-10-22).
//
// A member-owned bot's own computer is its server environment
// (sagax-environment, one isolated Linux sandbox per person), the Local VM or
// This computer of its owner (sagax-desktop), or its cloud computer. A raw
// host shell (Bash, shell, ...) runs on the SHARED organization server, which
// is an admin's to drive.
//
// Decision: a bot must run on its OWN computer by default and never assume it can
// run on the shared server; and only an admin may target the shared server.
// So a member bot's server command no longer waits for an admin in a dead
// end. When a non-admin drives the turn:
//   - the bot has its own computer  -> it is told to run there (no card),
//   - the bot has no computer        -> it is refused in plain words with
//     what the person can do (ownPlaceRefusal, #4449): no fallback to the
//     server and no admin card.
// When an admin drives the turn (or a person an admin gave the server-command
// right), the existing "runs on the server" card stays: an admin may target
// the shared server.
//
// Pure, tested on its own (server/exec-target.test.ts). The server decides
// the routing; it is never a UI-only choice.

export type OrgServerExecRouting = "admin-card" | "use-bot-computer" | "no-computer";

/** The routing for a member bot's command that would run on the shared
 * organization server. */
export function orgServerExecRouting(input: {
  /** An organization admin (or the local operator) drives this turn, or a
   * person an admin gave the server-command right: the shared server is
   * theirs to drive, so the existing "runs on the server" card stays. */
  callerMayDriveOrgServer: boolean;
  /** The bot has its own computer this turn: its server environment, its
   * Local VM or This computer, or its cloud computer. */
  botHasOwnComputer: boolean;
}): OrgServerExecRouting {
  if (input.callerMayDriveOrgServer) return "admin-card";
  return input.botHasOwnComputer ? "use-bot-computer" : "no-computer";
}

/** #4449: what the bot reads when a member's turn asked for work on the
 * shared host (a shell, an engine tool of the host such as a web fetch, a
 * file outside its own folders) while the bot has a computer of its own this
 * turn. Nothing waits for an admin: the work belongs in the person's own
 * place. */
export const EXEC_USE_BOT_COMPUTER =
  "Refused: the organization's server is never this bot's place, for a shell, a web fetch or a file outside its own folders. Do it on this bot's own computer instead (its server environment, its Local VM, This computer or its cloud computer, for example sagax-environment run_command with curl or gh, sagax-desktop, vm_exec or the computer tools), not on the host.";

/** #4449: the plain refusal when a member's turn asked for work on the
 * shared host and no place of the person's own can be had this turn. Never
 * an admin card, never a fallback to the shared host: it says why and what
 * the person can do. `decision` is the turn's workplace (desktop-bridge.ts
 * resolveBotWorkplace), absent when none was recorded. */
export function ownPlaceRefusal(decision: { target: string; principal: string | null; reason: string } | undefined): string {
  const never = "Commands and engine tools never run on the organization's server, and no admin is asked.";
  if (decision?.target === "user-desktop" || decision?.reason === "pinned-desktop") {
    return `Nothing ran: this conversation works on the person's own computer, and the Sagax desktop app on it is not connected right now. Tell them to open Sagax on that computer, or to set the bot's Workspace to Cloud to use their server environment. ${never}`;
  }
  if (!decision?.principal) {
    return `Nothing ran: no person asked for this turn, so it has no computer of its own. Ask the person to send the request from their own message. ${never}`;
  }
  return `Nothing ran: this organization has no server environment for the person yet, and their own computer is not connected. Tell them to connect the Sagax desktop app on their computer and set the bot's Workspace to This computer or Local VM. ${never}`;
}

/** A workplace target that means the bot has its own computer for the turn:
 * its owner's server environment ("user-sandbox"), the owner's own computer
 * or its Local VM ("user-desktop"). "host" (a solo server's own machine),
 * "none" (no sandbox, nobody known) and an absent target do not. */
export function workplaceIsBotComputer(target: string | undefined): boolean {
  return target === "user-sandbox" || target === "user-desktop";
}

/** The run targets a webhook (and any bot feature with an "Exécuter sur"
 * choice) may use that stay on the bot's own computer: "maus" (This computer)
 * and "cloud" (the bot's cloud computer). An absent or empty value is the
 * default, This computer. Only a target on the shared organization server is
 * an admin's, so only that one requires the server-settings right. */
const BOT_OWN_RUN_TARGETS: ReadonlySet<string> = new Set(["", "maus", "cloud"]);

export function webhookExecTargetAdminOnly(runOn: string | undefined): boolean {
  return !BOT_OWN_RUN_TARGETS.has((runOn ?? "").trim().toLowerCase());
}

/** 2026-10-27 (#1098): whether a card offers its standing grants (the
 * engine's session allow, the saved command list, an Always allow key) and
 * who saves a command from it. A member's bot on an organization server gets
 * them only for a call in the person's own sandbox (their cloud computer or
 * Local VM, mounted for this turn), where the owner answers and saves; on the
 * shared host they stay an admin's or a host.shell holder's
 * (`callerManagesHostCommands`). Any other bot keeps them as before. */
export function cardStandingGrants(input: { memberOwned: boolean; ownSandbox: boolean; callerManagesHostCommands: boolean }): { offered: boolean; ownerSavesCommand: boolean } {
  return {
    offered: !input.memberOwned || input.ownSandbox,
    ownerSavesCommand: input.ownSandbox || input.callerManagesHostCommands,
  };
}

