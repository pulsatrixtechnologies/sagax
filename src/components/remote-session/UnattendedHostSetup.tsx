// "Unattended Remote Control" setup (Pulsatrix Assist, 2026-11-06): adds a
// computer by issuing a one-time install code for the Sagax host. The host
// stays on once installed and becomes a place in the Computer menu; it then
// shows in the person's enrolled hosts. The code, the install command, the
// install link and the expiry each stay on screen with their Copy action.
import { useEffect, useRef, useState } from "react";
import { ExternalLink, KeyRound, Loader2, MonitorSmartphone } from "lucide-react";

import { UNATTENDED_HOST_SCOPES, type UnattendedHostScope } from "../../../shared/remote-unattended-host";
import { activeLocale, t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { CopyBlock } from "./CopyBlock";
import { createHostInstallCode, type HostInstallCode } from "./remote-hosts-client";

const control = "rounded-lg px-3 py-2 text-[12px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-40";
const field = "w-full rounded-lg border border-hairline/60 bg-inset px-3 py-2 text-[12px] text-ink outline-none focus:border-accent";

export function timeLabel(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(activeLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(date);
}

export function CopyRow({ label, value, mono, name }: { label: string; value: string; mono?: boolean; name: string }) {
  return <CopyBlock name={name} label={label} value={value} variant={mono ? "command" : "code"} />;
}

/** The add flow. `startRequest` above zero opens the form (e.g. the team
 * canvas "Add" menu); `onIssued` lets the host list refresh while it waits. */
export function UnattendedHostSetup({ available = true, reason, startRequest = 0, disabled, onIssued }: {
  available?: boolean;
  reason?: string;
  startRequest?: number;
  disabled?: boolean;
  onIssued?: (code: HostInstallCode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<UnattendedHostScope>("full-control");
  const [consentRef, setConsentRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<HostInstallCode | null>(null);
  const scopeInput = useRef<HTMLSelectElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (startRequest > 0) { setOpen(true); setIssued(null); } }, [startRequest]);
  useEffect(() => { if (open && !issued) scopeInput.current?.focus(); }, [open, issued]);

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const out = await createHostInstallCode({ scope, consentRef });
      if (!mounted.current) return;
      setIssued(out);
      onIssued?.(out);
    } catch (cause) {
      if (mounted.current) setError(readableError(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const close = () => { setOpen(false); setIssued(null); setError(""); setConsentRef(""); };

  return <section data-unattended-setup="" className="space-y-2 rounded-xl border border-hairline/60 bg-card p-3">
    <div className="flex items-start gap-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-control text-ink-secondary"><MonitorSmartphone size={18} /></span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{t("canvasComputers.unattended.title")}</span>
        <span className="block text-[11px] leading-relaxed text-ink-secondary">{t("canvasComputers.unattended.body")}</span>
      </span>
    </div>
    {!available && <p data-unattended-unavailable="" className="text-[11px] leading-relaxed text-warning">{reason || t("canvasComputers.unattended.unavailable")}</p>}
    {error && <p role="alert" className="rounded-lg bg-danger/10 p-2 text-[12px] text-danger">{error}</p>}
    {!open && <button type="button" data-unattended-add="" disabled={disabled} onClick={() => setOpen(true)}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-hairline/60 px-3 py-2 text-[12px] font-medium text-ink hover:bg-control disabled:opacity-40">
      <KeyRound size={14} /> {t("canvasComputers.unattended.add")}
    </button>}
    {open && !issued && <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void generate(); }}>
      <label className="block text-[11px] text-ink-secondary" htmlFor="unattended-scope">{t("canvasComputers.unattended.scope")}</label>
      <select ref={scopeInput} id="unattended-scope" data-unattended-scope="" className={field} value={scope} disabled={busy} onChange={(event) => setScope(event.target.value as UnattendedHostScope)}>
        {UNATTENDED_HOST_SCOPES.map((value) => <option key={value} value={value}>{t(`remoteSessionsAdmin.hosts.scope.${value}`)}</option>)}
      </select>
      <label className="block text-[11px] text-ink-secondary" htmlFor="unattended-consent">{t("canvasComputers.unattended.consent")}</label>
      <input id="unattended-consent" data-unattended-consent="" className={field} value={consentRef} maxLength={128} disabled={busy} onChange={(event) => setConsentRef(event.target.value)} />
      <div className="flex justify-end gap-1">
        <button type="button" className={control} disabled={busy} onClick={close}>{t("common.cancel")}</button>
        <button type="submit" data-unattended-generate="" className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-accent-ink disabled:opacity-40" disabled={busy || disabled}>
          {busy && <Loader2 size={13} className="animate-spin" />}{t("canvasComputers.unattended.generate")}
        </button>
      </div>
    </form>}
    {open && issued && <div data-unattended-code="" className="space-y-2.5">
      <CopyRow name="code" label={t("canvasComputers.unattended.codeLabel")} value={issued.code} />
      <CopyRow name="command" label={t("canvasComputers.unattended.commandLabel")} value={issued.installCommand} mono />
      {issued.enrollUrl && <a href={issued.enrollUrl} target="_blank" rel="noopener noreferrer" data-unattended-link="" className="flex items-center gap-1.5 rounded-lg px-1 py-1 text-[12px] text-accent hover:bg-control">
        {t("canvasComputers.unattended.link")} <ExternalLink size={11} />
      </a>}
      <p className="text-[11px] text-ink-secondary">
        {[issued.org, t(`remoteSessionsAdmin.hosts.scope.${issued.scope}`), issued.expiresAt ? t("canvasComputers.unattended.expires", { time: timeLabel(issued.expiresAt) }) : ""].filter(Boolean).join(" · ")}
      </p>
      <p className="text-[11px] leading-relaxed text-ink-secondary">{t("canvasComputers.unattended.waiting")}</p>
      <div className="flex justify-end"><button type="button" className={control} onClick={close}>{t("canvasComputers.unattended.done")}</button></div>
    </div>}
  </section>;
}
