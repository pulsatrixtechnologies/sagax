// "+ Add computer" on the Remote Sessions page (#2723, redone #2956): a
// modal in three steps with a visible stepper. 1) the OS (macOS, Windows,
// Linux) as three even tiles; 2) the mode, unattended (a card with the
// access level, an optional consent reference and which bots may use the
// computer, #2957) or assisted, once (a bot opens the session and gives the
// person a code to read out); 3) for unattended, the install code shown big,
// the exact command for that OS on one line that scrolls (never cut in the
// middle of a word) with Copy inside the block, the install link, the time
// left on the code, and "Waiting for the computer…" that turns into
// "<host> is connected" as soon as the host appears in the enrolled list.
// The Team map opens this same modal from its computer button.
import { useEffect, useMemo, useRef, useState } from "react";
import { Apple, Check, ExternalLink, Headset, KeyRound, Loader2, Monitor, Terminal, type LucideIcon } from "lucide-react";

import { UNATTENDED_HOST_SCOPES, type UnattendedHostOs, type UnattendedHostRow, type UnattendedHostScope } from "../../../shared/remote-unattended-host";
import { DialogFrame, DialogLayer, FIELD, FieldRow, GROUP_CARD, PILL, PillSelect, PRIMARY_PILL } from "@/components/SettingsPrimitives";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { useStore } from "@/state/store";
import { CopyBlock } from "./CopyBlock";
import { HostBotsPicker, useHostBotChoices } from "./HostSharingControls";
import { createHostInstallCode, setRemoteHostBots, type HostInstallCode } from "./remote-hosts-client";
import { unattendedHostLabel } from "./UnattendedHostsSection";

type Mode = "unattended" | "assisted";
type Step = "os" | "mode" | "done";
const STEPS: Step[] = ["os", "mode", "done"];

const OS_CHOICES: { value: UnattendedHostOs; label: string; icon: LucideIcon }[] = [
  { value: "macos", label: "macOS", icon: Apple },
  { value: "windows", label: "Windows", icon: Monitor },
  { value: "linux", label: "Linux", icon: Terminal },
];

/** The exact line for the chosen OS (older servers only send the POSIX line). */
export function commandFor(issued: HostInstallCode, os: UnattendedHostOs): string {
  return issued.installCommands?.[os] ?? issued.installCommand;
}

/** "14 min", "0:45", or "" once the code expired. */
export function timeLeftLabel(expiresAt: string | null, now = Date.now()): string {
  if (!expiresAt) return "";
  const left = Date.parse(expiresAt) - now;
  if (!Number.isFinite(left) || left <= 0) return "";
  const seconds = Math.ceil(left / 1000);
  if (seconds >= 120) return t("addComputer.minutes", { count: Math.ceil(seconds / 60) });
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The host that enrolled since the code was issued: a new enrolled id. */
export function newlyEnrolled(before: ReadonlySet<string>, hosts: readonly UnattendedHostRow[]): UnattendedHostRow | null {
  return hosts.find((row) => row.state === "enrolled" && !before.has(row.hostId)) ?? null;
}

function Stepper({ step }: { step: Step }) {
  const index = STEPS.indexOf(step);
  return (
    <ol data-add-computer-steps="" aria-label={t("addComputer.stepOf", { n: index + 1, total: STEPS.length })} className="flex items-center gap-1.5">
      {STEPS.map((each, i) => {
        const done = i < index;
        const current = i === index;
        return (
          <li key={each} aria-current={current ? "step" : undefined} data-add-computer-step={each} data-step-state={done ? "done" : current ? "current" : "todo"}
            className={cn("flex min-w-0 items-center gap-1.5", i > 0 && "flex-1")}>
            {i > 0 && <span aria-hidden="true" className={cn("h-px min-w-3 flex-1", done || current ? "bg-accent" : "bg-border")} />}
            <span aria-hidden="true" className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
              done ? "bg-accent text-accent-ink" : current ? "bg-accent text-accent-ink" : "border-[0.5px] border-border bg-raised text-ink-secondary")}>
              {done ? <Check size={11} strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn("truncate text-[12px]", current ? "font-semibold text-ink" : "text-ink-secondary")}>{t(`addComputer.steps.${each}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function OsTile({ selected, icon: Icon, title, onSelect, ...rest }: {
  selected: boolean; icon: LucideIcon; title: string; onSelect: () => void;
} & Record<`data-${string}`, string>) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect} {...rest}
      className={cn("flex min-h-[96px] min-w-0 flex-col items-center justify-center gap-2 rounded-xl border-[0.5px] px-3 py-4 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
        selected ? "border-accent bg-accent/10" : "border-border bg-elevated hover:bg-hover")}>
      <span className={cn("flex size-10 items-center justify-center rounded-full", selected ? "bg-accent text-accent-ink" : "bg-raised text-ink-secondary")}><Icon size={20} aria-hidden="true" /></span>
      <span className="text-[13px] font-semibold text-ink">{title}</span>
    </button>
  );
}

function ModeCard({ selected, icon: Icon, title, body, onSelect, ...rest }: {
  selected: boolean; icon: LucideIcon; title: string; body: string; onSelect: () => void;
} & Record<`data-${string}`, string>) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect} {...rest}
      className={cn("flex min-w-0 flex-col gap-2 rounded-xl border-[0.5px] px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
        selected ? "border-accent bg-accent/10" : "border-border bg-elevated hover:bg-hover")}>
      {/* Icon, title and the radio on one row; the description takes the
          whole card width below so it reads in two or three lines, not ten. */}
      <span className="flex min-w-0 items-center gap-2.5">
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", selected ? "bg-accent text-accent-ink" : "bg-raised text-ink-secondary")}><Icon size={15} aria-hidden="true" /></span>
        <span className="min-w-0 flex-1 text-[13px] font-semibold leading-[18px] text-ink">{title}</span>
        <span aria-hidden="true" className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px]", selected ? "border-accent bg-accent text-accent-ink" : "border-border")}>
          {selected && <Check size={10} strokeWidth={3} />}
        </span>
      </span>
      <span className="block text-[12px] leading-[17px] text-ink-secondary">{body}</span>
    </button>
  );
}

export function AddComputerDialog({ available = true, hosts = [], onClose, onIssued }: {
  /** Perspicax can issue codes on this server. */
  available?: boolean;
  /** The enrolled hosts as the page lists them: the new one turns "Waiting" into "Connected". */
  hosts?: readonly UnattendedHostRow[];
  onClose: () => void;
  /** A code was issued, or the dialog waits for the computer: the page refreshes its list. */
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
  const [bots, setBots] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<HostInstallCode | null>(null);
  const [connected, setConnected] = useState<UnattendedHostRow | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const before = useRef<Set<string>>(new Set());
  const mounted = useRef(true);
  const botChoices = useHostBotChoices();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { dialogRef.current?.focus({ preventScroll: true }); }, []);

  // The clock for "Code expires in …" and the list refresh while waiting.
  const waiting = step === "done" && issued !== null && connected === null;
  useEffect(() => {
    if (step !== "done") return;
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(clock);
  }, [step]);
  useEffect(() => {
    if (!waiting) return;
    const poll = window.setInterval(() => onIssued?.(), 5000);
    return () => window.clearInterval(poll);
  }, [waiting, onIssued]);
  // The host appeared: connected, and the bots chosen at step 2 apply to it.
  useEffect(() => {
    if (!waiting) return;
    const row = newlyEnrolled(before.current, hosts);
    if (!row) return;
    setConnected(row);
    if (bots && bots.length > 0) void setRemoteHostBots(row.hostId, bots).catch(() => { /* the row's Bots… menu stays the way to set it */ });
  }, [waiting, hosts, bots]);

  const bot = state.bots.find((candidate) => candidate.chiefOfStaff && !candidate.hidden) ?? state.bots.find((candidate) => !candidate.hidden);
  const osLabel = OS_CHOICES.find((choice) => choice.value === os)?.label ?? "";
  const timeLeft = useMemo(() => (issued ? timeLeftLabel(issued.expiresAt, now) : ""), [issued, now]);
  const expired = Boolean(issued?.expiresAt) && timeLeft === "" && !connected;

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      before.current = new Set(hosts.map((row) => row.hostId));
      const out = await createHostInstallCode({ scope, consentRef });
      if (!mounted.current) return;
      setIssued(out);
      setConnected(null);
      setNow(Date.now());
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
      <button type="button" data-add-computer-back="" className={PILL} disabled={busy} onClick={() => { setError(""); setStep("os"); }}>{t("addComputer.back")}</button>
      {mode === "unattended" ? (
        <button type="button" data-add-computer-generate="" className={PRIMARY_PILL} disabled={busy || !available} onClick={() => void generate()}>
          {busy && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}{t("canvasComputers.unattended.generate")}
        </button>
      ) : (
        <button type="button" data-add-computer-ask="" className={PRIMARY_PILL} disabled={!bot} onClick={askBot}>
          {bot ? t("addComputer.assisted.ask", { bot: bot.name }) : t("addComputer.assisted.noBot")}
        </button>
      )}
    </>
  ) : (
    <>
      <button type="button" data-add-computer-back="" className={PILL} onClick={() => { setIssued(null); setConnected(null); setStep("mode"); }}>{t("addComputer.back")}</button>
      <button type="button" data-add-computer-done="" className={PRIMARY_PILL} onClick={onClose}>{t("canvasComputers.unattended.done")}</button>
    </>
  );

  return (
    <DialogLayer onBackdropMouseDown={() => { if (!busy) onClose(); }}>
      <DialogFrame titleId="add-computer-title" title={t("remoteSessionsAdmin.addComputer")} subtitle={subtitle} width="md"
        closeLabel={t("common.close")} onClose={onClose} closeDisabled={busy} frameRef={dialogRef}
        frameProps={{ "data-add-computer": step, ...(connected ? { "data-add-computer-connected": "" } : {}) }} footer={footer}>
        <div className="flex flex-col gap-4">
          <Stepper step={step} />
          {error && <p role="alert" className="rounded-lg bg-danger/10 p-2 text-[12px] text-danger">{error}</p>}
          {step === "os" && (
            <div role="radiogroup" aria-label={t("addComputer.step.os")} className="grid grid-cols-3 gap-2.5">
              {OS_CHOICES.map((choice) => (
                <OsTile key={choice.value} data-add-computer-os={choice.value} selected={os === choice.value} icon={choice.icon} title={choice.label} onSelect={() => setOs(choice.value)} />
              ))}
            </div>
          )}
          {step === "mode" && (
            <>
              <div role="radiogroup" aria-label={t("addComputer.mode")} className="grid gap-2.5 sm:grid-cols-2">
                <ModeCard data-add-computer-mode="unattended" selected={mode === "unattended"} icon={KeyRound}
                  title={t("addComputer.unattended.title")} body={t("addComputer.unattended.body")} onSelect={() => setMode("unattended")} />
                <ModeCard data-add-computer-mode="assisted" selected={mode === "assisted"} icon={Headset}
                  title={t("addComputer.assisted.title")} body={t("addComputer.assisted.body")} onSelect={() => setMode("assisted")} />
              </div>
              {mode === "unattended" && (
                <section aria-label={t("addComputer.settings")} className="flex flex-col gap-2">
                  {!available && <p data-add-computer-unavailable="" className="rounded-lg bg-warning/10 p-2 text-[12px] leading-relaxed text-warning">{t("canvasComputers.unattended.unavailable")}</p>}
                  <div className={cn(GROUP_CARD, "divide-y divide-hairline/40 py-0")}>
                    <FieldRow label={t("canvasComputers.unattended.scope")} hint={t("addComputer.scopeHint")}>
                      <div data-add-computer-scope={scope}>
                        <PillSelect bordered value={scope} disabled={busy} ariaLabel={t("canvasComputers.unattended.scope")} onChange={setScope}
                          options={UNATTENDED_HOST_SCOPES.map((value) => ({ value, label: t(`remoteSessionsAdmin.hosts.scope.${value}`) }))} />
                      </div>
                    </FieldRow>
                    <FieldRow label={t("canvasComputers.unattended.consent")} hint={t("addComputer.consentHint")}>
                      <input data-add-computer-consent="" className={FIELD} value={consentRef} maxLength={128} disabled={busy} placeholder={t("addComputer.consentPlaceholder")} onChange={(event) => setConsentRef(event.target.value)} />
                    </FieldRow>
                    <div className="flex flex-col gap-1.5 px-3.5 py-2.5">
                      <p className="text-[13px] leading-[18px] text-ink">{t("addComputer.bots.label")}</p>
                      <p className="text-[12px] leading-[17px] text-ink-secondary">{t("addComputer.bots.hint")}</p>
                      <div data-add-computer-bots={bots ? bots.join(",") : "all"} className="mt-1">
                        <HostBotsPicker bots={botChoices} value={bots} onChange={setBots} disabled={busy} name={t("addComputer.bots.label")} />
                      </div>
                    </div>
                  </div>
                </section>
              )}
              {mode === "assisted" && (
                <p className="rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-secondary">{t("addComputer.assisted.hint", { os: osLabel })}</p>
              )}
            </>
          )}
          {step === "done" && issued && (
            <div data-unattended-code="" className="flex flex-col gap-4">
              <CopyBlock name="code" variant="code" label={t("canvasComputers.unattended.codeLabel")} value={issued.code}
                hint={expired ? t("addComputer.expired") : timeLeft ? t("addComputer.expiresIn", { time: timeLeft }) : undefined} />
              <CopyBlock name="command" variant="command" label={t("addComputer.commandFor", { os: osLabel })} value={commandFor(issued, os)}
                hint={os === "windows" ? t("addComputer.runWindows") : t("addComputer.runPosix")} />
              {issued.enrollUrl && (
                <CopyBlock name="link" variant="link" label={t("canvasComputers.unattended.link")} value={issued.enrollUrl}>
                  <a href={issued.enrollUrl} target="_blank" rel="noreferrer" data-add-computer-open-link="" aria-label={t("addComputer.openLink")} title={t("addComputer.openLink")} className="ui-icon-button shrink-0">
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                </CopyBlock>
              )}
              <p className="text-[12px] text-ink-secondary">
                {[issued.org, t(`remoteSessionsAdmin.hosts.scope.${issued.scope}`), bots && bots.length ? t("addComputer.bots.summary", { count: bots.length }) : t("remoteSessionsAdmin.hosts.bots.all")].filter(Boolean).join(" · ")}
              </p>
              {connected ? (
                <div data-add-computer-state="connected" role="status" className="flex items-start gap-2.5 rounded-xl border-[0.5px] border-success/40 bg-success/10 px-3.5 py-3">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-white"><Check size={12} strokeWidth={3} aria-hidden="true" /></span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-ink">{t("addComputer.connected", { host: unattendedHostLabel(connected) })}</span>
                    <span className="block text-[12px] leading-[17px] text-ink-secondary">{t("addComputer.connectedHint")}</span>
                  </span>
                </div>
              ) : (
                <div data-add-computer-state="waiting" role="status" className="flex items-start gap-2.5 rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-3">
                  <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-ink-secondary" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-ink">{t("addComputer.waiting")}</span>
                    <span className="block text-[12px] leading-[17px] text-ink-secondary">{t("canvasComputers.unattended.waiting")}</span>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogFrame>
    </DialogLayer>
  );
}
