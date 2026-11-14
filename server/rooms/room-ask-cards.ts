// #4219: keyed ask_choice cards in a room. A bot shared between several
// people raises its keyed card in the room (or from a routine run whose
// source is the room), can address it to one person of the room and
// re-address it by key, reads the room's people, and hears who answered.
// Isolation between people stays whole: only the people of the room answer,
// each as themselves, and an addressed card counts only its person's answer.
import type { AskAddressee, CardAnswerer, CardAnswererIdentity } from "../../shared/wire.ts";

/** A person of the room, as the bot reads them. */
export interface RoomPerson {
  id: string;
  name: string;
}

interface RoomLike {
  dm?: boolean;
  peopleDm?: boolean;
  memberIds?: readonly string[];
}

interface CardLike {
  askKey?: string;
  askTo?: AskAddressee;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether this conversation is a room (never a conversation between a
 * bot and a person, nor between two people). */
export function isRoom(room: RoomLike | null | undefined): boolean {
  return Boolean(room && !room.dm && !room.peopleDm);
}

/** Whether a person reads and posts in a room, by the room's own verdict
 * (`verdict`: server/index.ts viewerMayAnswerOnThread, the rule of
 * server/auth/authz.ts canInChannel over the people and teams the room lists
 * and its shared section's members). No id: the operator at this computer;
 * on a solo server the operator reads every room, signed in too. */
export function roomMayPost(
  viewerId: string | undefined,
  rule: { solo: boolean; operatorId: string; verdict: (id: string) => boolean },
): boolean {
  if (!viewerId) return true;
  if (rule.solo && same(viewerId, rule.operatorId)) return true;
  return rule.verdict(viewerId);
}

/** The room's people: everyone the room's own verdict lets post in it
 * (`mayPost`: server/index.ts viewerMayAnswerOnThread, the rule of
 * server/auth/authz.ts canInChannel over the people it lists, its teams and
 * its shared section), with their display names. */
export function roomPeople(
  candidates: Iterable<{ id: string; name: string }>,
  mayPost: (id: string) => boolean,
): RoomPerson[] {
  const seen = new Set<string>();
  const people: RoomPerson[] = [];
  for (const candidate of candidates) {
    const id = candidate.id.trim();
    if (!id || seen.has(id.toLowerCase()) || !mayPost(id)) continue;
    seen.add(id.toLowerCase());
    people.push({ id, name: candidate.name.trim() || id });
  }
  return people;
}

/** One line the bot reads: each person's display name and stable id. */
export function roomPeopleLine(people: readonly RoomPerson[]): string {
  if (!people.length) return "";
  return `People in this room (address a keyed ask_choice card to one of them with to): ${people.map((person) => `${person.name} (person id ${person.id})`).join(", ")}.`;
}

/** `to` (a person id, or a display name only one person of the room has)
 * as the person of the room it names. */
export function resolveAddressee(to: string, people: readonly RoomPerson[]):
  | { ok: true; addressee: AskAddressee }
  | { ok: false; error: string } {
  const wanted = to.trim().replace(/^@/, "");
  const byId = people.find((person) => same(person.id, wanted));
  if (byId) return { ok: true, addressee: { id: byId.id, name: byId.name } };
  const named = people.filter((person) => same(person.name, wanted));
  if (named.length === 1) return { ok: true, addressee: { id: named[0]!.id, name: named[0]!.name } };
  const listed = people.length ? roomPeopleLine(people) : "This conversation has no people to address a card to.";
  if (named.length > 1) return { ok: false, error: `to: several people of this room are named "${wanted}"; give their person id. ${listed}` };
  return { ok: false, error: `to: nobody in this room is "${wanted}". ${listed}` };
}

/** Whether a card is a keyed or addressed card of a room. */
export function isRoomAskCard(card: CardLike | null | undefined, room: RoomLike | null | undefined): boolean {
  return Boolean(card && isRoom(room) && (card.askKey || card.askTo));
}

/** Who may answer a keyed card of a room. `mayPost`: the room's own
 * verdict for the person answering (who reads and posts in the room may
 * answer); `answererId`: their person id. `refused` with the words to say;
 * `allowed` for a person of the room the card counts (any of them, or its
 * addressee alone); `other` when the rule does not apply (not such a card:
 * the server's own rules decide). */
export function roomAskAnswer(
  card: CardLike | null | undefined,
  room: RoomLike | null | undefined,
  answer: { mayPost: boolean; answererId?: string | null },
): { kind: "refused"; error: string } | { kind: "allowed" } | { kind: "other" } {
  if (!isRoomAskCard(card, room)) return { kind: "other" };
  if (!answer.mayPost) return { kind: "refused", error: "Only the people in this room can answer this card." };
  const to = card!.askTo;
  const who = answer.answererId?.trim() ?? "";
  if (to && !(who && same(to.id, who))) return { kind: "refused", error: `This card is addressed to ${to.name}: only their answer counts.` };
  return { kind: "allowed" };
}

/** Who hears a keyed card of a room: its addressee alone, else the room's
 * people (roomPeople). Undefined: not such a card (the usual audience). */
export function roomAskAudience(card: CardLike | null | undefined, room: RoomLike | null | undefined, people: readonly RoomPerson[]): string[] | undefined {
  if (!isRoomAskCard(card, room)) return undefined;
  if (card!.askTo) return [card!.askTo.id];
  return people.length ? people.map((person) => person.id) : undefined;
}

/** The room conversation a routine run's keyed card goes to: the routine's
 * results conversation, else the conversation that created it, when it is a
 * room (never a conversation between two bots or two people) that the
 * routine's bot is a member of. Null: the run's own conversation. */
export function routineRoomThread(
  routine: { resultsThreadId?: string; sourceThreadId?: string } | null | undefined,
  botId: string,
  roomOf: (threadId: string) => RoomLike | null | undefined,
): string | null {
  if (!routine) return null;
  for (const threadId of [routine.resultsThreadId, routine.sourceThreadId]) {
    if (!threadId) continue;
    const room = roomOf(threadId);
    if (room && isRoom(room) && (room.memberIds ?? []).includes(botId)) return threadId;
  }
  return null;
}

/** What the server holds for a person (server/auth/principals.ts), as far as
 * the answer names them. */
export interface KnownPerson {
  name?: string;
  email?: string;
  login?: string;
  controlPlaneUserId?: string;
  subject?: { iss: string; sub: string };
  perspicaxRole?: string;
  teams?: ReadonlyArray<{ id: string }>;
  label?: string;
}

/** Who answered a keyed room card: their stable id and display name, and
 * the identity fields the server already holds for them. */
export type AnswererIdentity = { id: string; name: string } & CardAnswererIdentity;

/** Who answered: their stable id and display name, and the identity fields
 * the server already holds for them on the organization's products. */
export function answererIdentity(id: string, name: string, person: KnownPerson | null | undefined): AnswererIdentity {
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
  const email = text(person?.email);
  const login = text(person?.login);
  const accountId = text(person?.controlPlaneUserId);
  const subject = text(person?.subject?.sub);
  const role = text(person?.perspicaxRole);
  const label = text(person?.label);
  const teams = (person?.teams ?? []).map((team) => team.id).filter(Boolean);
  return {
    id,
    name: name.trim() || id,
    ...(email ? { email } : {}),
    ...(login ? { login } : {}),
    ...(accountId ? { accountId } : {}),
    ...(subject ? { subject } : {}),
    ...(role ? { role } : {}),
    ...(teams.length ? { teams } : {}),
    ...(label ? { label } : {}),
  };
}

/** The card's one `answeredBy` (server/index-leaves/answeringCardAs.ts
 * words how: by voice, through a bot, from a reach-me channel), named with
 * who answered. */
export function answeredByWith(base: CardAnswerer, identity: AnswererIdentity): CardAnswerer {
  if (base.kind === "worker") return base;
  return { ...base, ...identity };
}

const IDENTITY_KEYS = ["id", "name", "email", "login", "accountId", "subject", "role", "teams", "label"] as const;

/** The person who answered (the card's `answeredBy`), in the words the bot
 * reads: JSON, so a name cannot pass for another field. Empty when the card
 * does not name them (no stable id). */
export function answererText(answeredBy: CardAnswerer | null | undefined): string {
  if (!answeredBy || answeredBy.kind === "worker") return "";
  if (typeof answeredBy.id !== "string" || !answeredBy.id || typeof answeredBy.name !== "string" || !answeredBy.name) return "";
  const picked: Record<string, unknown> = {};
  for (const key of IDENTITY_KEYS) {
    const value = (answeredBy as unknown as Record<string, unknown>)[key];
    if (value !== undefined) picked[key] = value;
  }
  return JSON.stringify(picked);
}
