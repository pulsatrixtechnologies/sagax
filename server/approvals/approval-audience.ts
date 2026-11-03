import type { BotHost } from "../turns/turn-route.ts";

export interface ApprovalViewer {
  userId: string;
  deviceId: string | null;
}

/** The owner's session. `deviceId` is null on the fleet host, and the
 * machine id when the turn runs on a worker. Channel members are not an
 * audience: `humanIds` is not an input. */
export function approvalAudience(input: {
  ownerUserId: string;
  host: BotHost;
}): { userId: string; deviceId: string | null } {
  if (input.host.kind === "machine") return { userId: input.ownerUserId, deviceId: input.host.deviceId };
  return { userId: input.ownerUserId, deviceId: null };
}

/** Fleet (`deviceId` null): the owner's userId. Machine: that userId only
 * when this session is the registered worker for that device. */
export function receivesApprovalCard(
  viewer: ApprovalViewer,
  audience: { userId: string; deviceId: string | null },
): boolean {
  if (!viewer.userId || viewer.userId !== audience.userId) return false;
  if (audience.deviceId === null) return true;
  return viewer.deviceId === audience.deviceId;
}

/** An answer counts only from `audience.userId`. Anyone else is refused
 * and the card is returned as it was, not applied. */
export function answerApproval<T>(input: {
  callerUserId: string;
  audience: { userId: string; deviceId: string | null };
  card: T;
}): { status: 403; card: T } | { status: 200; card: T } {
  if (input.callerUserId !== input.audience.userId) return { status: 403, card: input.card };
  return { status: 200, card: input.card };
}

/** Questions stay on the ordinary answer path. An approval with no live bot
 * does too, so a stored card can still be cleared. A live bot's approval is
 * 403 unless the caller is the owner. */
export function approvalAnswerStatus(input: {
  question: boolean;
  audience: { userId: string; deviceId: string | null } | null;
  callerUserId: string;
}): 403 | null {
  if (input.question || !input.audience) return null;
  return answerApproval({
    callerUserId: input.callerUserId,
    audience: input.audience,
    card: null,
  }).status === 403 ? 403 : null;
}

function cardStillOpen(card: unknown): boolean {
  if (!card || typeof card !== "object") return false;
  const row = card as { answered?: unknown; dismissed?: unknown; expired?: unknown };
  return !row.answered && !row.dismissed && !row.expired;
}

/** What another viewer learns of a settled card: the verdict and who gave
 * it, never the title, the request, the tool or its arguments. No
 * `requestId`, so no client can offer to answer it. */
export interface SettledCardForOthers {
  title: "";
  subtitle: "";
  options: [];
  answered?: string;
  answeredBy?: unknown;
  dismissed?: true;
  expired?: true;
}

function settledForOthers(card: unknown): SettledCardForOthers | null {
  if (!card || typeof card !== "object") return null;
  const row = card as { answered?: unknown; answeredBy?: unknown; dismissed?: unknown; expired?: unknown };
  const slim: SettledCardForOthers = { title: "", subtitle: "", options: [] };
  if (typeof row.answered === "string") slim.answered = row.answered.slice(0, 200);
  if (row.answeredBy && typeof row.answeredBy === "object") slim.answeredBy = row.answeredBy;
  if (row.dismissed) slim.dismissed = true;
  if (row.expired) slim.expired = true;
  return slim;
}

/** The matching session keeps the card. Every other session does not get
 * the card. While it is still open they get `waiting-on-owner` and the
 * owner's name; once settled, `owner-settled` with only the verdict and
 * who answered (slice 7: a console answer reads "<name> (console)"). */
export function approvalDelivery<T extends { card?: unknown }>(input: {
  audience: { userId: string; deviceId: string | null };
  viewer: ApprovalViewer;
  message: T;
  ownerName: string;
}): T | Omit<T, "card"> | (Omit<T, "card"> & { state: "waiting-on-owner" | "owner-settled"; ownerName: string; card?: SettledCardForOthers }) {
  if (receivesApprovalCard(input.viewer, input.audience)) return input.message;
  const { card, ...rest } = input.message;
  if (!cardStillOpen(card)) {
    const slim = settledForOthers(card);
    return slim ? { ...rest, card: slim, state: "owner-settled", ownerName: input.ownerName } : rest;
  }
  return { ...rest, state: "waiting-on-owner", ownerName: input.ownerName };
}
