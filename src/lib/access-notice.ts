// #3656: a turn that could not run for lack of access (src/components/
// AccessCard.tsx) is a row of the conversation's history, never a live
// status. It belongs to the person's message that got no answer (the
// nearest one of theirs above it), and it reads as resolved once the access
// works again: a later answer of the same bot that ran on the card's own
// engine (in a room where each person pays, an answer to that person's own
// ask), or, for a card about the viewer's own access, their engine now
// running their turns
// (GET /api/me/engines, src/lib/perspicax-org.ts).
import type { Message } from "@/state/store";
import type { MyEngine } from "@/lib/perspicax-org";
import type { WireAccessCard } from "../../shared/wire";

export interface AccessNoticePlace {
  /** The person's message that got no answer, when it is in the loaded transcript. */
  failed?: Message;
  /** The person's messages after it that got no answer either: the server
   * writes the same card once until the bot answers (shared/failure-dedup.ts). */
  laterAsks: number;
  /** The failed message is the viewer's own: the caption may say "your". */
  mine: boolean;
  /** The access works again: the card keeps its words, without its actions. */
  resolved: boolean;
}

const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

function engineOf(access: WireAccessCard, engines: readonly MyEngine[]): MyEngine | undefined {
  if (access.instanceId) {
    const byId = engines.find((engine) => engine.instanceId === access.instanceId);
    if (byId) return byId;
  }
  return engines.find((engine) => same(engine.displayName, access.engine));
}

/** The viewer's own engine serves them again for what this card asked. */
function ownAccessBack(access: WireAccessCard, engines: readonly MyEngine[] | null, viewerPrincipalId: string | null): boolean {
  if (!engines?.length) return false;
  const payer = access.payerPrincipalId || access.ownerPrincipalId;
  if (!same(viewerPrincipalId, payer)) return false;
  const engine = engineOf(access, engines);
  if (!engine) return false;
  if (access.reason === "sign_in") return engine.subscription.signedIn && !engine.subscription.expired;
  if (access.reason !== "no_access") return false;
  // someone else's access, or an account matter: the viewer's engine says nothing of it
  if (access.cause === "payer_disabled" || access.cause === "owner_model_offline") return false;
  if (access.cause === "server_engine_not_allowed") return engine.myTurns === "subscription" || engine.myTurns === "key";
  return engine.myTurns === "subscription" || engine.myTurns === "key" || engine.myTurns === "org-key";
}

/** Where an access card sits in its conversation, and whether it still holds.
 * `room`: a conversation with several people, where a user message with no
 * sender is not known to be the card's person. */
export function accessNoticePlace(card: Message, transcript: readonly Message[], engines: readonly MyEngine[] | null, viewerPrincipalId: string | null, room = false): AccessNoticePlace {
  const access = card.access;
  if (!access) return { laterAsks: 0, mine: false, resolved: false };
  const index = transcript.findIndex((message) => message.id === card.id);
  const above = index >= 0 ? transcript.slice(0, index) : transcript.filter((message) => message.at <= card.at && message.id !== card.id);
  const below = index >= 0 ? transcript.slice(index + 1) : transcript.filter((message) => message.at > card.at);
  // The person whose message got no answer: the one who spoke, else the one
  // who pays. Another member's message in a room is never this card's.
  const person = access.speakerPrincipalId || access.payerPrincipalId;
  const theirs = (message: Message) => {
    if (message.role !== "user") return false;
    const sender = message.sender?.id;
    if (sender) return person ? same(sender, person) : !room;
    // no sender: the operator's own message, known only in a 1:1 chat
    return !room;
  };
  let failed: Message | undefined;
  // A sign-in card the server writes on its own (a connector's sign-in) is
  // no failed reply: it shows its own time.
  if (access.reason !== "sign_in") {
    if (card.requestMessageId) {
      failed = transcript.find((message) => message.id === card.requestMessageId && message.role === "user");
    } else {
      for (let j = above.length - 1; j >= 0; j--) {
        if (theirs(above[j]!)) { failed = above[j]; break; }
      }
    }
  }
  const answers = (message: Message) =>
    message.role === "bot" && message.kind === "text" && Boolean(message.text?.trim()) && (!message.from?.botId || message.from.botId === access.botId);
  const answer = below.findIndex(answers);
  const laterAsks = !failed ? 0 : (answer >= 0 ? below.slice(0, answer) : below).filter(theirs).length;
  // A bot that asks for a sign-in keeps talking in the same turn: only the
  // sign-in itself settles that card. An answer settles it only when it ran
  // on the card's own engine: a bot moved to another engine answers without
  // the card's access being back.
  const cardEngine = access.instanceId || (engines ? engines.find((engine) => same(engine.displayName, access.engine))?.instanceId : undefined);
  // In a room where each person pays for their own turns, another member's
  // answered turn ran on their access, not on this card's person's: only an
  // answer to this person's own ask settles the card there.
  const ownerPays = access.payer === "owner" || Boolean(access.ownerPays);
  const forThisPerson = (message: Message) => {
    if (!room || ownerPays) return true;
    const ask = message.requestMessageId ? transcript.find((m) => m.id === message.requestMessageId) : undefined;
    return Boolean(ask && theirs(ask));
  };
  const answeredSince = access.reason !== "sign_in" && Boolean(cardEngine) &&
    below.some((message) => answers(message) && same(message.turnRun?.instanceId, cardEngine) && forThisPerson(message));
  // "your" only to that person: in a 1:1 chat the conversation is the viewer's own
  const mine = Boolean(failed) && (person ? (!room || same(viewerPrincipalId, person)) : !room);
  return { ...(failed ? { failed } : {}), laterAsks, mine, resolved: answeredSince || ownAccessBack(access, engines, viewerPrincipalId) };
}
