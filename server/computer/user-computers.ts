// A bot on an organization server works on the computer of the PERSON who
// asks, never on the server's own machine (managed-policy.ts
// HOST_COMPUTER_REFUSAL) and never on anyone else's.
//
// A person's computer is reached through a target:
//   "user-desktop"  their own Sagax desktop app, connected to this server
//                   (Settings > Organization > This computer for your bots), which
//                   runs each action on that computer within the folders and
//                   capabilities they shared (server/computer/shared-computers.ts,
//                   electron/computer-sharing.mjs);
//   "user-sandbox"  a per-person sandbox on the server's side, provided by
//                   its own module when it exists.
// Each target is a provider; the router only decides WHOSE computer a call
// may reach: the speaking person's, only while it is connected. Pure, so the
// rules are tested on their own (user-computers.test.ts).
import type { TurnSpeaker } from "../engines/engine-access.ts";

export const USER_COMPUTER_TARGETS = ["user-desktop", "user-sandbox"] as const;
export type UserComputerTarget = (typeof USER_COMPUTER_TARGETS)[number];

export interface UserComputerProvider<Computer = unknown, Operation extends { computer_id: string } = { computer_id: string }> {
  target: UserComputerTarget;
  /** This person's computers that are connected right now. */
  list(principalId: string): Computer[];
  /** Whether this computer is this person's and connected. */
  owns(principalId: string, computerId: string): boolean;
  /** Run one action on it. Called only after `owns` said yes. */
  request(principalId: string, operation: Operation, active: () => boolean): Promise<unknown>;
}

/** The settings row a person actually sees (settings.serverMode.computerTitle). */
const COMPUTER_ROW = 'Settings > Organization, the row "This computer for your bots" (French: "Cet ordinateur pour tes bots")';

export const USER_COMPUTER_MESSAGES = {
  noPerson: "No person asked in this turn, so no one's computer can be used: only the person's own words, or a routine of their own bot (scheduled or run by hand), can reach the computer they shared. A webhook, an email or someone else's routine cannot. Ask the person to request it themselves.",
  notConnected: `The computer of the person asking is not connected. Ask them to open the Sagax desktop app on their computer, signed in to this server, and choose access under ${COMPUTER_ROW}. The button is "Choose access" (French: "Choisir l'accès"). Nothing runs on the server instead.`,
  /** The server has not turned computer access on (features.sharedComputers).
   * The member's row has no button; an administrator has to enable it. */
  notAccepted: `The computer of the person asking is not connected. This server does not accept computer access yet, so the member cannot turn it on. An administrator turns it on in the server's settings. The row is ${COMPUTER_ROW}. Nothing runs on the server instead.`,
  notTheirs: "That computer is not the computer of the person asking. Only their own computer can be used; list it with list_shared_computers.",
} as const;

const refusal = (message: string, status: number, code: string) => Object.assign(new Error(message), { status, code });

/** 2026-10-26 (a person's bots work in their own environment): what
 * the caller knows of the turn beyond its speaker, so a routine of the
 * person's own bot reaches the computer they shared. */
export interface SpeakingContext {
  /** The owner of the bot the turn runs on. */
  botOwner?: string;
  /** What started the routine this turn descends from: "schedule",
   * "manual", "webhook" or another source. Absent: unknown. */
  automationTrigger?: string;
}

/** The person a turn speaks for, when a PERSON asked: their own message, or
 * a bot hop that carries that person's request. 2026-10-26: also the bot's
 * owner for a routine of their own bot that runs as them, scheduled or
 * started by hand (its own turn, or a hop from it whose routine they pay
 * for). A routine run as someone else, a webhook, a typed trigger or an
 * unknown start, the operator's loopback and an unattributed hop speak for
 * nobody here. */
export function speakingPerson(speaker: TurnSpeaker | undefined, context: SpeakingContext = {}): string | null {
  if (!speaker) return null;
  const owner = context.botOwner?.trim().toLowerCase() || "";
  const ownTrigger = context.automationTrigger === "schedule" || context.automationTrigger === "manual";
  const principal = speaker.origin === "operator" ? undefined : speaker.principalId?.trim().toLowerCase();
  if (speaker.origin === "owner-routine") {
    return owner && ownTrigger && principal === owner ? owner : null;
  }
  if (speaker.origin !== "person" && speaker.origin !== "peer") return null;
  if (speaker.origin === "peer" && speaker.routine) {
    const payer = speaker.routinePayer?.trim().toLowerCase();
    return owner && ownTrigger && payer === owner && (principal === undefined || principal === owner) ? owner : null;
  }
  return principal || null;
}

export interface UserComputerRouter {
  /** The speaking person's connected computers, across targets. */
  list(speaker: TurnSpeaker | undefined, context?: SpeakingContext): { target: UserComputerTarget; computer: unknown }[];
  /** One action on the speaking person's own computer. */
  request(speaker: TurnSpeaker | undefined, operation: { computer_id: string }, active: () => boolean, context?: SpeakingContext): Promise<unknown>;
}

export function createUserComputerRouter(
  providers: readonly UserComputerProvider<unknown, never>[],
  options: { /** False when this server has not turned computer access on. */
    sharingOffered?: () => boolean;
  } = {},
): UserComputerRouter {
  const all = providers as readonly UserComputerProvider<unknown, { computer_id: string }>[];
  const notConnected = () =>
    options.sharingOffered && !options.sharingOffered()
      ? USER_COMPUTER_MESSAGES.notAccepted
      : USER_COMPUTER_MESSAGES.notConnected;
  return {
    list(speaker, context) {
      const person = speakingPerson(speaker, context);
      if (!person) throw refusal(USER_COMPUTER_MESSAGES.noPerson, 403, "no_person");
      const computers = all.flatMap((provider) => provider.list(person).map((computer) => ({ target: provider.target, computer })));
      if (!computers.length) throw refusal(notConnected(), 409, "not_connected");
      return computers;
    },
    async request(speaker, operation, active, context) {
      const person = speakingPerson(speaker, context);
      if (!person) throw refusal(USER_COMPUTER_MESSAGES.noPerson, 403, "no_person");
      const provider = all.find((candidate) => candidate.owns(person, operation.computer_id));
      if (!provider) {
        const connected = all.some((candidate) => candidate.list(person).length > 0);
        throw connected
          ? refusal(USER_COMPUTER_MESSAGES.notTheirs, 403, "not_theirs")
          : refusal(notConnected(), 409, "not_connected");
      }
      return provider.request(person, operation, active);
    },
  };
}
