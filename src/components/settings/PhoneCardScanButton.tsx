// "Scanner avec l'iPhone" in the vault's New card form (audit row 84): asks
// the person's paired iPhone to read the card on the phone (Vision), with
// approval there, and fills the number, the expiry and the name. The
// security code is never read: the person types it. Shown only while a
// phone of theirs can scan (server/routes/phone-tools.ts).
import { useEffect, useRef, useState } from "react";

import { t } from "@/lib/i18n";
import { cardScanAvailable, runCardScan, type ScannedCard } from "@/lib/phone-card-scan";
import { PILL } from "../SettingsPrimitives";

type State = "idle" | "waiting" | "done" | "denied" | "expired" | "failed";

export function PhoneCardScanButton({ onRead, available: forced }: { onRead: (card: ScannedCard) => void; available?: boolean }) {
  const [available, setAvailable] = useState(forced ?? false);
  const [state, setState] = useState<State>("idle");
  // the six digits the iPhone shows too: same code, same one-time key
  const [code, setCode] = useState<string | null>(null);
  // the number field is masked: say what was read beside it (last four, expiry)
  const [summary, setSummary] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (forced !== undefined) return;
    let live = true;
    void cardScanAvailable().then((yes) => { if (live) setAvailable(yes); });
    return () => { live = false; };
  }, [forced]);
  // leaving the form gives up on the scan: the phone's card closes
  useEffect(() => () => abort.current?.abort(), []);

  if (!available) return null;

  const start = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setState("waiting");
    try {
      setCode(null);
      const outcome = await runCardScan(controller.signal, setCode);
      if (outcome.status === "cancelled") return setState("idle");
      if (outcome.status === "done") {
        onRead(outcome.card);
        setSummary(scannedCardSummary(outcome.card));
        return setState("done");
      }
      setState(outcome.status === "denied" ? "denied" : outcome.status === "expired" ? "expired" : "failed");
    } catch {
      setState("failed");
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  };

  return (
    <div className="flex flex-col gap-1" data-phone-card-scan>
      <div className="flex items-center gap-2">
        {state === "waiting"
          ? <button type="button" className={PILL} onClick={() => abort.current?.abort()}>{t("vault.phoneScan.cancel")}</button>
          : <button type="button" className={PILL} onClick={() => void start()}>{t("vault.phoneScan.button")}</button>}
        {state === "waiting" && <span className="text-[12px] text-ink-secondary" role="status">{t("vault.phoneScan.waiting")}</span>}
        {state === "waiting" && code && <span className="text-[12px] text-ink-secondary" data-phone-card-scan-code>{t("vault.phoneScan.code", { code: `${code.slice(0, 3)} ${code.slice(3)}` })}</span>}
      </div>
      {state !== "idle" && state !== "waiting" && (
        <p className="text-[12px] text-ink-secondary" role="status">{state === "done" && summary ? summary : t(`vault.phoneScan.${state === "done" ? "failed" : state}` as const)}</p>
      )}
    </div>
  );
}

/** The form's draft fields a scanned card fills (never the security code). */
export function scannedCardFields(card: ScannedCard): { pan: string; expMonth?: string; expYear?: string; holder?: string } {
  return {
    pan: card.number,
    ...(card.expMonth ? { expMonth: String(card.expMonth) } : {}),
    ...(card.expYear ? { expYear: String(card.expYear) } : {}),
    ...(card.holder ? { holder: card.holder } : {}),
  };
}

/** What the form says it filled: the last four digits and the expiry,
 * never the whole number (the field itself is masked). */
export function scannedCardSummary(card: ScannedCard): string {
  const last4 = card.number.slice(-4);
  if (!card.expMonth || !card.expYear) return t("vault.phoneScan.doneNoExpiry", { last4 });
  return t("vault.phoneScan.done", { last4, expiry: `${String(card.expMonth).padStart(2, "0")}/${card.expYear}` });
}
