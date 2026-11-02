// Who a request speaks for: the signed-in person, or the operator at this
// computer. Leaf helpers shared by the route slices that leave server/index.ts
// (#1388). Never import index.ts from here.
import { createHash } from "node:crypto";

import type { TurnSpeaker } from "./engine-access.ts";
import type { RequestAuth } from "./request-auth.ts";
import type { SessionRecord } from "./sessions.ts";

/** Who a request's turn speaks for (engine access): the signed-in person, or
 * the operator at this computer. A reduced-trust loopback caller (a bot's own
 * shell on a hosted server) is nobody in particular. */
export function speakerFor(auth: RequestAuth): TurnSpeaker {
  if (auth.kind === "session") return { origin: "person", principalId: personKey(auth.session) };
  return auth.trust === "service" ? { origin: "person" } : { origin: "operator" };
}

/** A stable key for the person behind a session: their principal id
 * (server/principals.ts), so a new device or a changed email is still them.
 * A session without one falls back to the older hashed key. */
export function personKey(session: Pick<SessionRecord, "id" | "email" | "principalId">): string {
  return session.principalId ?? legacyPersonKey(session);
}

/** Before principals: their account email when they signed in with one,
 * else the paired session itself. Hashed, so a message or a thread can
 * carry it without handing other members a session id. Threads and cards
 * recorded then still carry it. */
export function legacyPersonKey(session: Pick<SessionRecord, "id" | "email">): string {
  const basis = session.email ? `email:${session.email.trim().toLowerCase()}` : `session:${session.id}`;
  return `p_${createHash("sha256").update(basis).digest("base64url").slice(0, 22)}`;
}
