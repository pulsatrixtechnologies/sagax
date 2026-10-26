// "Scanner avec l'iPhone" (audit row 84): the New card form asks the
// person's paired iPhone to read a card (server/routes/phone-tools.ts).
// End to end (JC 2026-10-21): the form makes a one-time key, the phone
// seals the number, the expiry and the name for it, and only this form
// opens the envelope (shared/phone-card-seal.ts). The server relays it and
// never holds the number in clear. Never the security code.
import { api } from "@/state/store";
import { cardScanMatchCode, createCardScanKey, openSealedCard, type CardScanKey, type OpenedCard, type SealedCard } from "../../shared/phone-card-seal";

export type ScannedCard = OpenedCard;
export type CardScanOutcome =
  | { status: "done"; sealed: SealedCard }
  | { status: "pending"; requestId: string }
  | { status: "denied" }
  | { status: "failed"; error: string }
  | { status: "expired" };

const BASE = "/api/me/phone-tools/card-scan";

export const cardScanAvailable = () => api<{ available: boolean }>(BASE).then((row) => row.available === true).catch(() => false);
export const startCardScan = (publicKey: string) => api<{ requestId: string; expiresAt: number }>(BASE, { method: "POST", body: JSON.stringify({ publicKey }) });
export const waitCardScan = (id: string, signal?: AbortSignal) =>
  api<CardScanOutcome>(`${BASE}/${encodeURIComponent(id)}/wait`, { method: "POST", body: "{}", signal });
export const cancelCardScan = (id: string) => api<{ ok: true; cancelled: boolean }>(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);

export type CardScanResult =
  | { status: "done"; card: ScannedCard }
  | { status: "denied" }
  | { status: "failed"; error: string }
  | { status: "expired" }
  | { status: "cancelled" };

/** Makes the one-time key, shows its code (`onCode`, the same six digits
 * the iPhone shows), waits for the phone, opens its envelope here. */
export async function runCardScan(
  signal: AbortSignal,
  onCode: (code: string) => void = () => {},
  deps: { start: typeof startCardScan; wait: typeof waitCardScan; cancel: typeof cancelCardScan; key?: () => Promise<CardScanKey> } = { start: startCardScan, wait: waitCardScan, cancel: cancelCardScan },
): Promise<CardScanResult> {
  const key = await (deps.key ?? createCardScanKey)();
  onCode(await cardScanMatchCode(key.publicKey));
  const { requestId } = await deps.start(key.publicKey);
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      const outcome = await deps.wait(requestId, signal);
      if (outcome.status === "pending") continue;
      if (outcome.status !== "done") return outcome;
      try {
        return { status: "done", card: await openSealedCard(key, requestId, outcome.sealed) };
      } catch {
        return { status: "failed", error: "The card could not be read." };
      }
    }
  } catch (error) {
    if (signal.aborted) {
      await deps.cancel(requestId);
      return { status: "cancelled" };
    }
    throw error;
  }
}
