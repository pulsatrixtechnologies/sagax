// The terms of use, accepted once per account (App Store guideline 1.2,
// src/lib/moderation.ts): shown after sign-in while the server says this
// person has not accepted them. The acceptance is kept on the server with
// its date, so no other device asks again. An older server without the
// route asks nothing. A person alone on their server (#4360,
// src/lib/server-alone.ts) reads no line about reports, blocking or admins:
// there is nobody else to report or block.
import { useEffect, useRef, useState } from "react";
import { openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import { acceptTerms, fetchTerms, TERMS_URL, type TermsStatus } from "@/lib/moderation";
import { loadServerAlone } from "@/lib/server-alone";
import { viewerIsOrgAdmin } from "@/lib/group-owner";
import { useStoreSelector } from "@/state/store-selector";
import { DialogFrame, DialogLayer, PILL, PRIMARY_PILL } from "./SettingsPrimitives";
import { readableError } from "@/lib/plain-error";

export function TermsGate() {
  // who is signed in: a new account asks again
  const who = useStoreSelector((current) => current.config?.viewer ? `${current.config.viewer.principalId ?? ""}|${current.config.viewer.email}` : null);
  const [terms, setTerms] = useState<TermsStatus | null>(null);
  const admin = useStoreSelector((current) => viewerIsOrgAdmin(current.config));
  const [alone, setAlone] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agree = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (who === null) return;
    let alive = true;
    setTerms(null);
    // Asks whether the person is alone only when the gate will show (terms
    // not accepted yet), and before showing it, so the wording never changes
    // under the reader.
    void fetchTerms().then(async (status) => {
      const solo = status && !status.accepted ? await loadServerAlone(admin) : false;
      if (!alive) return;
      setAlone(solo);
      setTerms(status);
    });
    return () => { alive = false; };
  }, [who, admin]);
  const open = Boolean(terms && !terms.accepted);
  useEffect(() => { if (open) agree.current?.focus(); }, [open]);
  if (!open || !terms) return null;
  const accept = async () => {
    setPending(true);
    setError(null);
    try {
      setTerms(await acceptTerms(terms.current));
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setPending(false);
    }
  };
  return (
    <DialogLayer>
      <DialogFrame
        titleId="terms-gate-title"
        title={t("moderation.terms.title")}
        subtitle={t("moderation.terms.subtitle")}
        width="md"
        frameProps={{ "data-terms-gate": "" }}
        footer={(
          <>
            <button type="button" className={PILL} onClick={() => void openExternalLink(terms.url || TERMS_URL)}>{t("moderation.terms.read")}</button>
            <button ref={agree} type="button" className={PRIMARY_PILL} disabled={pending} onClick={() => void accept()} data-terms-accept="">{t("moderation.terms.accept")}</button>
          </>
        )}
      >
        <p className="text-[13px] leading-[19px] text-ink">{t("moderation.terms.body")}</p>
        <p className="mt-2 text-[13px] leading-[19px] text-ink">{t(alone ? "moderation.terms.zeroToleranceSolo" : "moderation.terms.zeroTolerance")}</p>
        {error && <p role="alert" className="mt-2 text-[12.5px] text-danger">{error}</p>}
      </DialogFrame>
    </DialogLayer>
  );
}
