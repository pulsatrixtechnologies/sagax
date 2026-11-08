// "+ Add computer" on the Remote Sessions page (#2723): a modal in three
// steps, no device list and no drag. 1) the OS (macOS, Windows, Linux);
// 2) the mode: unattended (the access level and an optional consent
// reference, then a one-time install code) or assisted, once (a bot opens
// the session and gives the person a code to read out); 3) for unattended,
// the exact command for that OS with Copy, the install link and the expiry.
// The team canvas keeps CanvasComputers for placing computers on a team.
import { useEffect, useRef, useState } from "react";
import { Apple, Headset, KeyRound, Loader2, Monitor, Terminal, type LucideIcon } from "lucide-react";

import { UNATTENDED_HOST_SCOPES, type UnattendedHostOs, type UnattendedHostScope } from "../../../shared/remote-unattended-host";
import { DialogFrame, DialogLayer, FIELD, FieldRow, PILL, PillSelect, PRIMARY_PILL } from "@/components/SettingsPrimitives";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { useStore } from "@/state/store";
import { createHostInstallCode, type HostInstallCode } from "./remote-hosts-client";
import { CopyRow, timeLabel } from "./UnattendedHostSetup";

type Mode = "unattended" | "assisted";
type Step = "os" | "mode" | "done";

const OS_CHOICES: { value: UnattendedHostOs; label: string; icon: LucideIcon }[] = [
  { value: "macos", label: "macOS", icon: Apple },
  { value: "windows", label: "Windows", icon: Monitor },
  { value: "linux", label: "Linux", icon: Terminal },
];

/** The exact line for the chosen OS (older servers only send the POSIX line). */
export function commandFor(issued: HostInstallCode, os: UnattendedHostOs): string {
  return issued.installCommands?.[os] ?? issued.installCommand;
}

function Choice({ selected, icon: Icon, title, body, onSelect, ...rest }: {
  selected: boolean; icon: LucideIcon; title: string; body?: string; onSelect: () => void;
} & Record<`data-${string}`, string>) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect} {...rest}
      className={cn("flex min-w-0 flex-1 items-start gap-2.5 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
        selected ? "border-accent bg-accent/10" : "border-hairline/50 bg-panel hover:border-hairline")}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-secondary"><Icon size={16} aria-hidden="true" /></span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-ink">{title}</span>
        {body && <span className="mt-0.5 block text-[12px] leading-[17px] text-ink-secondary">{body}</span>}
      </span>
    </button>
  );
}

export function AddComputerDialog({ available = true, onClose, onIssued }: {
  /** Perspicax can issue codes on this server. */
  available?: boolean;
  onClose: () => void;
  /** A code was issued: the list refreshes while the computer installs. */
  onIssued?: () => void;
}) {
  const { state, dispatch } = useStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDialog(dialogRef, onClose);
  const [step, setStep] = useState<Step>("os");
  const [os, setOs] = useState<UnattendedHostOs>("macos");
  const [mode, setMode] = useState<Mode>("unattended");
  const [scope, setScope] = useState<UnattendedHostScope>("full-control");
  const [consentRef, setConsentRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<HostInstallCode | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { dialogRef.current?.focus({ preventScroll: true }); }, []);

  const bot = state.bots.find((candidate) => candidate.chiefOfStaff && !candidate.hidden) ?? state.bots.find((candidate) => !candidate.hidden);
  const osLabel = OS_CHOICES.find((choice) => choice.value === os)?.label ?? "";

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const out = await createHostInstallCode({ scope, consentRef });
      if (!mounted.current) return;
      setIssued(out);
      setStep("done");
      onIssued?.();
    } catch (cause) {
      if (mounted.current) setError(readableError(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const askBot = () => {
    if (!bot) return;
    dispatch({ type: "send", botId: bot.id, text: t("addComputer.assisted.prompt", { os: osLabel }) });
    dispatch({ type: "select", id: bot.id });
    onClose();
  };

  const subtitle = step === "os" ? t("addComputer.step.os") : step === "mode" ? t("addComputer.step.mode", { os: osLabel }) : t("addComputer.step.done", { os: osLabel });
  const footer = step === "os" ? (
    <>
      <button type="button" className={PILL} onClick={onClose}>{t("common.cancel")}</button>
      <button type="button" data-add-computer-next="" className={PRIMARY_PILL} onClick={() => setStep("mode")}>{t("addComputer.next")}</button>
    </>
  ) : step === "mode" ? (
    <>
      <button type="button" className={PILL} disabled={busy} onClick={() => { setError(""); setStep("os"); }}>{t("addComputer.back")}</button>
      {mode === "unattended" ? (
        <button type="button" data-add-computer-generate="" className={PRIMARY_PILL} disabled={busy || !available} onClick={() => void generate()}>
          {busy && <Loader2 size={13} className="mr-1.5 inline animate-spin" aria-hidden="true" />}{t("canvasComputers.unattended.generate")}
        </button>
      ) : (
        <button type="button" data-add-computer-ask="" className={PRIMARY_PILL} disabled={!bot} onClick={askBot}>
          {bot ? t("addComputer.assisted.ask", { bot: bot.name }) : t("addComputer.assisted.noBot")}
        </button>
      )}
    </>
  ) : (
    <>
      <button type="button" className={PILL} onClick={() => { setIssued(null); setStep("mode"); }}>{t("addComputer.back")}</button>
      <button type="button" data-add-computer-done="" className={PRIMARY_PILL} onClick={onClose}>{t("canvasComputers.unattended.done")}</button>
    </>
  );

  return (
    <DialogLayer onBackdropMouseDown={() => { if (!busy) onClose(); }}>
      <DialogFrame titleId="add-computer-title" title={t("remoteSessionsAdmin.addComputer")} subtitle={subtitle} width="md"
        closeLabel={t("common.close")} onClose={onClose} closeDisabled={busy} frameRef={dialogRef}
        frameProps={{ "data-add-computer": step }} footer={footer}>
        <div className="flex flex-col gap-3">
          {error && <p role="alert" className="rounded-lg bg-danger/10 p-2 text-[12px] text-danger">{error}</p>}
          {step === "os" && (
            <div role="radiogroup" aria-label={t("addComputer.step.os")} className="flex flex-col gap-2 sm:flex-row">
              {OS_CHOICES.map((choice) => (
                <Choice key={choice.value} data-add-computer-os={choice.value} selected={os === choice.value} icon={choice.icon} title={choice.label} onSelect={() => setOs(choice.value)} />
              ))}
            </div>
          )}
          {step === "mode" && (
            <>
              <div role="radiogroup" aria-label={t("addComputer.mode")} className="flex flex-col gap-2 sm:flex-row">
                <Choice data-add-computer-mode="unattended" selected={mode === "unattended"} icon={KeyRound}
                  title={t("addComputer.unattended.title")} body={t("addComputer.unattended.body")} onSelect={() => setMode("unattended")} />
                <Choice data-add-computer-mode="assisted" selected={mode === "assisted"} icon={Headset}
                  title={t("addComputer.assisted.title")} body={t("addComputer.assisted.body")} onSelect={() => setMode("assisted")} />
              </div>
              {mode === "unattended" && (
                <div className="flex flex-col gap-3">
                  {!available && <p data-add-computer-unavailable="" className="text-[12px] leading-relaxed text-warning">{t("canvasComputers.unattended.unavailable")}</p>}
                  <FieldRow label={t("canvasComputers.unattended.scope")}>
                    <div data-add-computer-scope={scope}>
                      <PillSelect bordered value={scope} disabled={busy} ariaLabel={t("canvasComputers.unattended.scope")} onChange={setScope}
                        options={UNATTENDED_HOST_SCOPES.map((value) => ({ value, label: t(`remoteSessionsAdmin.hosts.scope.${value}`) }))} />
                    </div>
                  </FieldRow>
                  <FieldRow label={t("canvasComputers.unattended.consent")}>
                    <input data-add-computer-consent="" className={FIELD} value={consentRef} maxLength={128} disabled={busy} onChange={(event) => setConsentRef(event.target.value)} />
                  </FieldRow>
                </div>
              )}
              {mode === "assisted" && (
                <p className="text-[12px] leading-relaxed text-ink-secondary">{t("addComputer.assisted.hint", { os: osLabel })}</p>
              )}
            </>
          )}
          {step === "done" && issued && (
            <div data-unattended-code="" className="flex flex-col gap-2.5">
              <CopyRow name="command" label={t("addComputer.commandFor", { os: osLabel })} value={commandFor(issued, os)} mono />
              <p className="text-[12px] text-ink-secondary">{os === "windows" ? t("addComputer.runWindows") : t("addComputer.runPosix")}</p>
              <CopyRow name="code" label={t("canvasComputers.unattended.codeLabel")} value={issued.code} />
              {issued.enrollUrl && (
                <CopyRow name="link" label={t("canvasComputers.unattended.link")} value={issued.enrollUrl} mono />
              )}
              <p className="text-[12px] text-ink-secondary">
                {[issued.org, t(`remoteSessionsAdmin.hosts.scope.${issued.scope}`), issued.expiresAt ? t("canvasComputers.unattended.expires", { time: timeLabel(issued.expiresAt) }) : ""].filter(Boolean).join(" · ")}
              </p>
              <p className="text-[12px] leading-relaxed text-ink-secondary">{t("canvasComputers.unattended.waiting")}</p>
            </div>
          )}
        </div>
      </DialogFrame>
    </DialogLayer>
  );
}
