// Who a routine runs as, chosen in the routine modal (2026-10-08). On an
// organization server a routine acts with one person's credentials: their
// routine delegation (issued automatically at their sign-in since #149) and
// their rights on the bot. By default that person is whoever wrote the
// routine's work (D5), else the bot's owner. This module decides who may pick
// someone else, and whom:
//
//   - an organization admin: every active person of the directory;
//   - a team manager: the people of the teams they manage, and themselves;
//     a manager with no managed team (the server has no teams for them):
//     themselves and the bot's owner;
//   - anyone else: nobody but themselves (the modal shows no dropdown);
//   - a solo server: no choice at all.
//
// Only people are listed: never a service account, a linked server or a
// system account (the directory's persons, as the Perspicax 1.8.2 people
// pickers list them). A person who cannot run the bot's routines (owner, or
// shared at `run` or above) is listed but cannot be chosen, with the reason.
// Pure functions; server/index.ts wires the directory, the rights and the
// delegations.

export interface RunAsChooser {
  principalId: string;
  admin: boolean;
  /** The teams this person manages (empty: none). */
  managedTeamIds: readonly string[];
  /** Perspicax says this person is a manager (even with no team here). */
  manager: boolean;
}

export interface RunAsPerson {
  principalId: string;
  name: string;
  avatarUrl?: string;
  disabled: boolean;
  /** A Perspicax service account: never listed. */
  service?: boolean;
  teams?: readonly { id: string; manager: boolean }[];
}

/** How far a chooser reaches. */
export type RunAsScope = "all" | "teams" | "self_owner" | "self";

export function runAsScope(chooser: RunAsChooser): RunAsScope {
  if (chooser.admin) return "all";
  if (chooser.managedTeamIds.length > 0) return "teams";
  if (chooser.manager) return "self_owner";
  return "self";
}

const same = (a: string | undefined, b: string | undefined) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/** Whether this person is within the chooser's reach (rights on the bot
 * aside). */
export function runAsInScope(chooser: RunAsChooser, person: Pick<RunAsPerson, "principalId" | "teams">, botOwnerId: string | undefined): boolean {
  if (same(person.principalId, chooser.principalId)) return true;
  const scope = runAsScope(chooser);
  if (scope === "all") return true;
  if (scope === "teams") {
    const managed = new Set(chooser.managedTeamIds);
    return (person.teams ?? []).some((team) => managed.has(team.id));
  }
  if (scope === "self_owner") return same(person.principalId, botOwnerId);
  return false;
}

/** A person the routine can be listed with: an active person, never a
 * service account. */
export function runAsListable(person: RunAsPerson): boolean {
  return !person.disabled && !person.service;
}

export interface RunAsOption {
  principalId: string;
  name: string;
  avatarUrl?: string;
  /** False: listed for context, cannot be chosen (`reason` says why). */
  selectable: boolean;
  reason?: "no_right";
  /** They hold no routine delegation yet: the routine runs once they sign in. */
  pending?: true;
}

export interface RunAsOptionsInput {
  chooser: RunAsChooser;
  people: readonly RunAsPerson[];
  botOwnerId: string | undefined;
  /** Whether this person may run the bot's routines. */
  mayRun: (principalId: string) => boolean;
  /** Whether this person holds a live routine delegation. */
  delegated: (principalId: string) => boolean;
}

/** What the modal's dropdown lists. `canChoose` false: no dropdown. */
export function runAsOptions(input: RunAsOptionsInput): { canChoose: boolean; people: RunAsOption[] } {
  if (runAsScope(input.chooser) === "self") return { canChoose: false, people: [] };
  const people = input.people
    .filter((person) => runAsListable(person) && runAsInScope(input.chooser, person, input.botOwnerId))
    .map((person): RunAsOption => {
      const selectable = input.mayRun(person.principalId);
      return {
        principalId: person.principalId,
        name: person.name,
        ...(person.avatarUrl ? { avatarUrl: person.avatarUrl } : {}),
        selectable,
        ...(selectable ? {} : { reason: "no_right" as const }),
        ...(input.delegated(person.principalId) ? {} : { pending: true as const }),
      };
    });
  return { canChoose: true, people };
}

export type RunAsRefusal = {
  status: 400 | 403;
  error: string;
  code: "run_as_not_allowed" | "run_as_not_person" | "run_as_out_of_scope" | "run_as_no_right";
  /** 2026-10-09: the permission that would let the chooser pick anyone. */
  permission?: "routines.runAsAnyone";
};

/** Whether `chooser` may make the routine run as `principalId` (null: yes).
 * The chooser's own right to run the bot is checked by the route before. */
export function runAsRefusal(input: {
  chooser: RunAsChooser;
  principalId: string;
  /** The directory's person behind `principalId`, null when none. */
  person: RunAsPerson | null;
  botOwnerId: string | undefined;
  mayRun: (principalId: string) => boolean;
}): RunAsRefusal | null {
  if (same(input.principalId, input.chooser.principalId)) return null;
  if (runAsScope(input.chooser) === "self") {
    return { status: 403, error: "Only an organization admin or a team manager can choose who a routine runs as.", code: "run_as_not_allowed", permission: "routines.runAsAnyone" };
  }
  if (!input.person || !runAsListable(input.person)) {
    return { status: 400, error: "A routine can only run as an active person of the organization.", code: "run_as_not_person" };
  }
  if (!runAsInScope(input.chooser, input.person, input.botOwnerId)) {
    return { status: 403, error: "You can only choose a person of the teams you manage.", code: "run_as_out_of_scope", permission: "routines.runAsAnyone" };
  }
  if (!input.mayRun(input.principalId)) {
    return { status: 403, error: `${input.person.name || "This person"} cannot run this bot's routines. Share the bot with them at Run routines or above first.`, code: "run_as_no_right" };
  }
  return null;
}
