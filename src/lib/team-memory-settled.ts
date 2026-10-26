// A late click on a "Remember this for the team?" card that someone already
// settled (on another card, or an admin on the team-memory page): the server
// answers 409 with code "team_memory_settled" and the real outcome
// (server/team-memory-cards.ts). The card shows that outcome and the person
// reads who settled it, in their language.

import { t } from "@/lib/i18n";

export const TEAM_MEMORY_SETTLED_CODE = "team_memory_settled";

export interface TeamMemorySettled {
  /** What the person reads. */
  text: string;
  /** The card as the server now holds it. */
  card: { answered: string; dismissed?: boolean };
}

/** The settled outcome a failed card answer carries, or null for any other error. */
export function teamMemorySettled(error: unknown): TeamMemorySettled | null {
  if (!error || typeof error !== "object") return null;
  const { status, body } = error as { status?: unknown; body?: unknown };
  if (status !== 409 || !body || typeof body !== "object") return null;
  const { code, outcome, settledBy } = body as { code?: unknown; outcome?: unknown; settledBy?: unknown };
  if (code !== TEAM_MEMORY_SETTLED_CODE) return null;
  const who = typeof settledBy === "string" && settledBy.trim() ? settledBy.trim() : undefined;
  if (outcome === "allowed-once") {
    return { text: who ? t("teamMemory.settled.accepted", { who }) : t("teamMemory.settled.someoneAccepted"), card: { answered: "allow" } };
  }
  if (outcome === "rejected") {
    return { text: who ? t("teamMemory.settled.declined", { who }) : t("teamMemory.settled.someoneDeclined"), card: { answered: "deny" } };
  }
  return { text: t("teamMemory.settled.gone"), card: { answered: "unavailable", dismissed: true } };
}
