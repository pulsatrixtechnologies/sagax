// Update prompt. Updates download by themselves (upstream #2342), so nothing
// shows while a background check runs or downloads. A downloaded update
// opens a small "Update ready" dialog (Later, Restart to install) whose
// release notes unfold under "What's new"; "Later" leaves the sidebar's
// update button, which opens it again (openUpdatePrompt). Errors and the
// Linux package hand-off stay on the small bottom-left card.
//
// The person's own "Check for updates" (requestUpdateCheck: account menu >
// Help, Settings > Updates) opens the same dialog at once and follows the
// check: searching, "Sagax X.Y.Z is available" with its notes and the
// download's progress (Later leaves it downloading in the background, the
// sidebar's pill shows the progress), "Update ready", "Sagax is up to date",
// or the failure with Try again. Nothing installs from the menu: only this
// dialog's "Restart to install", which tells main it was confirmed
// (2026-10-19: on Windows the menu item quit into a silent install).
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { appVersion } from "@/lib/app-links";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useUpdaterState, type UpdaterState } from "@/lib/updater";
import { useReportUpdateActivity } from "@/lib/update-activity";
import { useUpdateCheckRequests, useUpdatePromptRequests } from "@/lib/update-prompt";
import { ReleaseNotesBody } from "./ReleaseNotesMarkdown";
import { CountPill, DialogFrame, DialogLayer, GROUP_CARD, PILL, PRIMARY_PILL } from "./SettingsPrimitives";

const NOTES_STATUS = new Set<UpdaterState["status"]>(["preparing", "downloaded", "installing"]);

function friendlyError(message?: string): string {
  if (!message) return t("updates.problem.generic");
  if (/cannot find .*\.yml|404/i.test(message))
    return t("updates.problem.noRelease");
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::/i.test(message))
    return t("updates.problem.offline");
  return message.split("\n")[0].slice(0, 140);
}

function busyLabel(s: UpdaterState, pending: "install" | "check" | null): string {
  if (s.status === "preparing") return t("settings.updates.preparingShort");
  if (s.status === "installing" || pending === "install") {
    return s.installMode === "handoff" ? t("settings.updates.opening") : t("releaseNotes.restarting");
  }
  if (s.status === "downloading" && s.percent != null) return t("releaseNotes.percent", { percent: Math.round(s.percent) });
  return t("releaseNotes.starting");
}

function isWindows(): boolean {
  return typeof window !== "undefined" && window.ogb?.platform === "win32";
}

function notesTitle(s: UpdaterState): string {
  const version = s.version ?? "";
  // What a check found, named before anything installs.
  if (s.status === "downloading") return t("releaseNotes.updateTitle", { name: brand().name, version }).replace("  ", " ");
  if (s.status === "preparing") return t("releaseNotes.preparing");
  if (s.status === "installing") {
    return s.installMode === "handoff" ? t("settings.updates.openingTerminal") : t("releaseNotes.restarting");
  }
  if (s.status === "downloaded") return t("releaseNotes.readyTitle");
  return t("releaseNotes.updateTitle", { name: brand().name, version });
}

/** The sentence under "Update ready": what the restart does (on Windows:
 * the installer's own progress window, then Sagax again), or the terminal
 * hand-off of a system package. */
export function readyBody(s: UpdaterState, windows = isWindows()): string {
  if (s.installMode === "handoff") return t("settings.updates.readyInstall", { version: s.version ?? "" });
  // An unknown version leaves a double space behind, in every language.
  if (windows) return t("updates.dialog.windowsReadyBody", { app: brand().name, version: s.version ?? "" }).replace("  ", " ");
  return t("releaseNotes.readyBody", { app: brand().name, version: s.version ?? "" }).replace("  ", " ");
}

/** null: no check the person asked for is being followed. "checking": their
 * check is under way; "done": it answered (the state says what it found). */
export type UpdateFollow = null | "checking" | "done";

export type UpdateView = "none" | "checking" | "up-to-date" | "notes" | "problem-dialog" | "problem-card";

const FOUND = new Set<UpdaterState["status"]>(["downloading", "preparing", "downloaded", "installing", "handed-off"]);

/** Which window the updater state shows. While the person's own check is
 * followed every step has one; otherwise a background check and its
 * download stay quiet until the update is ready. */
export function updateView(s: UpdaterState | null, follow: UpdateFollow): UpdateView {
  if (!s) return "none";
  const status = s.status;
  if (follow) {
    // Until the check answers, an idle or an older failed state reads as
    // "checking" (no flash of the previous failure).
    if (status === "checking" || (follow === "checking" && (status === "idle" || status === "error"))) return "checking";
    if (status === "idle") return "up-to-date";
    if (status === "error") return "problem-dialog";
    if (status === "handed-off") return "problem-card";
    return "notes";
  }
  if (status === "idle" || status === "checking" || status === "downloading") return "none";
  if (NOTES_STATUS.has(status)) return "notes";
  return "problem-card";
}

export function UpdateBanner() {
  // The updater learns how many bots work: a restart warns or waits for them.
  useReportUpdateActivity();
  const s = useUpdaterState();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [pending, setPending] = useState<"install" | "check" | null>(null);
  const [follow, setFollow] = useState<UpdateFollow>(null);
  const status = s?.status;
  useEffect(() => setPending(null), [status]);
  // the sidebar's update button asks for the dialog again after "Later"
  const requests = useUpdatePromptRequests();
  useEffect(() => {
    if (requests > 0) setDismissed(null);
  }, [requests]);

  // The person's "Check for updates": follow it in the dialog. An update
  // already found (downloading, ready) is shown as it is, never checked again.
  const latest = useRef(s);
  latest.current = s;
  const checks = useUpdateCheckRequests();
  // The counter is module-wide: a remount must not replay an old request.
  const handledChecks = useRef(checks);
  const runCheck = () => {
    setDismissed(null);
    setFollow("checking");
    void Promise.resolve(window.ogb?.updater?.check())
      .catch(() => {})
      .finally(() => setFollow((current) => (current === "checking" ? "done" : current)));
  };
  useEffect(() => {
    if (checks === handledChecks.current) return;
    handledChecks.current = checks;
    if (FOUND.has(latest.current?.status ?? "idle")) {
      setDismissed(null);
      setFollow("done");
      return;
    }
    runCheck();
    // runCheck reads only setters and the bridge
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checks]);

  const view = updateView(s, follow);
  if (!s || view === "none") return null;
  const key = `${s.status}:${s.version ?? ""}`;
  if (!follow && dismissed === key) return null;

  const dismiss = () => {
    setFollow(null);
    setDismissed(key);
  };
  const beginUpdate = () => {
    const updater = window.ogb?.updater;
    if (!updater || s.status !== "downloaded") return;
    setPending("install");
    // The person chose "Restart to install" here: that is the confirmation.
    void updater.install({ confirmed: true });
  };
  // "Restart once the bots have finished" (one time), or take it back.
  const waitForBots = (on: boolean) => void window.ogb?.updater?.installWhenIdle?.(on);
  const retry = () => {
    setPending("check");
    runCheck();
  };
  // A native staging failure cannot be retried in place (Squirrel.Mac has no
  // cancel); quitting and reopening is the remedy the message names.
  const quitAndReopen = () => void window.ogb?.relaunch?.();

  if (view === "checking" || view === "up-to-date") {
    return <UpdateCheckDialog checking={view === "checking"} onDismiss={dismiss} />;
  }
  if (view === "notes") {
    return <UpdateNotesDialog state={s} pending={pending} onDismiss={dismiss} onUpdate={beginUpdate} onWaitForBots={waitForBots} />;
  }
  if (view === "problem-dialog") {
    return <UpdateProblemDialog state={s} pending={pending} onDismiss={dismiss} onRetry={retry} onQuit={quitAndReopen} />;
  }
  return <UpdateProblemCard state={s} pending={pending} onDismiss={dismiss} onRetry={retry} onQuit={quitAndReopen} />;
}

/** The person's check, while it runs and when it found nothing. */
export function UpdateCheckDialog({ checking, onDismiss }: { checking: boolean; onDismiss: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, [checking]);
  useEscape(onDismiss, false);
  const version = appVersion();
  return (
    <DialogLayer className="z-[60]" onBackdropMouseDown={onDismiss}>
      <DialogFrame
        titleId="update-check-title"
        title={checking ? t("sidebar.update.checking") : t("updates.dialog.upToDateTitle", { app: brand().name })}
        frameProps={{ "aria-describedby": "update-check-body", "aria-busy": checking, "data-update-dialog": checking ? "checking" : "up-to-date" }}
        footer={
          <button ref={closeRef} type="button" onClick={onDismiss} className={checking ? PILL : PRIMARY_PILL}>
            {checking ? t("releaseNotes.later") : t("releaseNotes.close")}
          </button>
        }
      >
        <p id="update-check-body" role="status" className="-mt-2 flex items-center gap-2 text-[13px] leading-[19px] text-ink-secondary">
          {checking ? (
            <>
              <Loader2 size={14} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {t("updates.dialog.checkingBody")}
            </>
          ) : (
            <>
              <Check size={14} className="shrink-0 text-accent" aria-hidden="true" />
              {version === "dev" ? t("updates.dialog.upToDateBodyPlain") : t("updates.dialog.upToDateBody", { version })}
            </>
          )}
        </p>
      </DialogFrame>
    </DialogLayer>
  );
}

function useEscape(onDismiss: () => void, busy: boolean) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || busy) return;
      event.preventDefault();
      onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onDismiss]);
}

export function UpdateNotesDialog({
  state: s,
  pending,
  onDismiss,
  onUpdate,
  onWaitForBots,
}: {
  state: UpdaterState;
  pending: "install" | "check" | null;
  onDismiss: () => void;
  onUpdate: () => void;
  onWaitForBots?: (on: boolean) => void;
}) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const laterRef = useRef<HTMLButtonElement>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const installing = s.status === "installing";
  const preparing = s.status === "preparing";
  const downloading = s.status === "downloading";
  const busy = downloading || preparing || installing || pending !== null;
  // "Later" stays open while the update downloads or is prepared: nothing
  // installs, the work goes on in the background. Only a started install
  // (or a click on its way) holds the window.
  const locked = installing || pending === "install";
  const handoff = s.installMode === "handoff";

  useEffect(() => {
    (primaryRef.current ?? laterRef.current)?.focus();
  }, [s.status]);

  useEscape(onDismiss, locked);

  // Bots at work would be cut short by the restart: say so, and offer to
  // wait for them (the notes and the Windows flow stay as they are).
  const activeBots = s.status === "downloaded" && !handoff ? s.activeBots ?? 0 : 0;
  const waiting = s.waitingForBots === true && s.status === "downloaded";

  const primaryLabel = handoff ? t("settings.updates.install") : t("releaseNotes.restartToInstall");

  const notesId = "update-notes-list";
  // 2026-10-16 (JC): drawn like Settings: the title, one grey line, the
  // notes folded in a row of one card behind a pill, the pills at the right.
  return (
    <DialogLayer className="z-[60]" onBackdropMouseDown={() => { if (!locked) onDismiss(); }}>
      <DialogFrame
        titleId="update-notes-title"
        title={notesTitle(s)}
        width={notesOpen ? "lg" : "sm"}
        frameProps={{ "aria-describedby": "update-notes-body", "data-update-dialog": "" }}
        footer={
          <>
            <button ref={laterRef} type="button" onClick={onDismiss} disabled={locked} className={PILL}>
              {t("releaseNotes.later")}
            </button>
            {busy ? (
              <button type="button" disabled className={PRIMARY_PILL}>
                <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                {busyLabel(s, pending)}
              </button>
            ) : (
              <button ref={primaryRef} type="button" onClick={onUpdate} className={PRIMARY_PILL}>
                {primaryLabel}
              </button>
            )}
          </>
        }
      >
        <p id="update-notes-body" className="-mt-2 px-0 text-[13px] leading-[19px] text-ink-secondary empty:hidden">
          {s.status === "downloaded"
            ? readyBody(s)
            : downloading
              ? t("updates.dialog.downloadingBody")
              : preparing
                ? t("settings.updates.preparing")
                : installing && s.message
                  ? s.message
                  : installing && !handoff && isWindows()
                    ? t("updates.dialog.windowsInstallingBody", { app: brand().name })
                    : null}
        </p>

        {activeBots > 0 && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] leading-[18px] text-ink-secondary" data-update-bots="">
            <span>{waiting ? t("updates.dialog.waitingBots") : t("updates.dialog.botsWorking", { count: activeBots })}</span>
            {onWaitForBots && (
              <button type="button" onClick={() => onWaitForBots(!waiting)} className={PILL} disabled={busy}>
                {waiting ? t("updates.dialog.waitCancel") : t("updates.dialog.waitForBots")}
              </button>
            )}
          </div>
        )}

        {downloading && (
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s.percent == null ? undefined : Math.round(s.percent)} aria-label={t("releaseNotes.downloading", { version: s.version ?? "" })}>
            <div className="text-[12.5px] text-ink-secondary">
              {s.percent == null
                ? t("releaseNotes.starting")
                : t("releaseNotes.percent", { percent: Math.round(s.percent) })}
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-control">
              <div
                className={cn("h-full rounded-full bg-accent transition-[width]", s.percent == null && "w-1/4 animate-pulse")}
                style={s.percent == null ? undefined : { width: `${Math.min(100, Math.max(0, s.percent))}%` }}
              />
            </div>
          </div>
        )}

        {/* The feed's notes stay one tap away rather than filling the dialog. */}
        <div className={GROUP_CARD}>
          <div className="flex min-h-[44px] items-center justify-between gap-3 px-3.5 py-1 md:min-h-[36px]">
            <span className="min-w-0 truncate text-[13px] leading-[18px] text-ink">
              {t("releaseNotes.whatsNew", { version: s.version ?? "" }).replace(/\s+$/, "")}
            </span>
            <span data-update-notes-toggle="">
              <CountPill
                open={notesOpen}
                onToggle={() => setNotesOpen((open) => !open)}
                label={t("releaseNotes.whatsNew", { version: s.version ?? "" }).replace(/\s+$/, "")}
                controls={notesId}
              />
            </span>
          </div>
          {notesOpen && (
            <div id={notesId} className="max-h-[50dvh] overflow-y-auto border-t-[0.5px] border-border px-2.5 pb-2 pt-3">
              <ReleaseNotesBody notes={s.notes} fallbackVersion={s.version ?? ""} />
            </div>
          )}
        </div>
      </DialogFrame>
    </DialogLayer>
  );
}

/** A failure of the person's own check: in the dialog they are looking at. */
export function UpdateProblemDialog({
  state: s,
  pending,
  onDismiss,
  onRetry,
  onQuit,
}: {
  state: UpdaterState;
  pending: "install" | "check" | null;
  onDismiss: () => void;
  onRetry: () => void;
  onQuit?: () => void;
}) {
  const retryable = s.retryable !== false;
  const primaryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primaryRef.current?.focus();
  }, []);
  useEscape(onDismiss, false);
  const body = retryable
    ? friendlyError(s.message)
    : `${friendlyError(s.message?.split(" Quit and reopen ")[0])} ${t("updates.problem.reopen", { app: brand().name })}`;
  return (
    <DialogLayer className="z-[60]" onBackdropMouseDown={onDismiss}>
      <DialogFrame
        titleId="update-problem-title"
        title={t("updates.problem.failedTitle")}
        role="alertdialog"
        frameProps={{ "aria-describedby": "update-problem-body", "data-update-dialog": "error" }}
        footer={
          <>
            <button type="button" onClick={onDismiss} disabled={pending !== null} className={PILL}>
              {t("releaseNotes.close")}
            </button>
            {retryable ? (
              <button ref={primaryRef} type="button" onClick={onRetry} disabled={pending !== null} className={PRIMARY_PILL}>
                {pending === "check" ? (
                  <>
                    <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> {t("common.checking")}
                  </>
                ) : (
                  t("updates.problem.retry")
                )}
              </button>
            ) : (
              // The staging failed and cannot be retried in place: the remedy
              // is to quit and reopen, so that action must stay clickable.
              <button ref={primaryRef} type="button" onClick={onQuit} className={PRIMARY_PILL}>
                {t("settings.updates.quitReopen")}
              </button>
            )}
          </>
        }
      >
        <p id="update-problem-body" className="-mt-2 text-[13px] leading-[19px] text-ink-secondary">{body}</p>
      </DialogFrame>
    </DialogLayer>
  );
}

function UpdateProblemCard({
  state: s,
  pending,
  onDismiss,
  onRetry,
  onQuit,
}: {
  state: UpdaterState;
  pending: "install" | "check" | null;
  onDismiss: () => void;
  onRetry: () => void;
  onQuit?: () => void;
}) {
  const title = s.status === "handed-off" ? t("updates.problem.terminalTitle") : t("updates.problem.failedTitle");
  const subtitle =
    s.status === "handed-off"
      ? s.terminalOpened
        ? t("updates.problem.terminalOpened")
        : t("updates.problem.terminalPaste")
      : s.retryable === false
        ? `${friendlyError(s.message?.split(" Quit and reopen ")[0])} ${t("updates.problem.reopen", { app: brand().name })}`
        : friendlyError(s.message);

  return (
    <div role="status" className="animate-panel-in fixed bottom-4 left-4 z-50 w-[300px] rounded-[14px] border-[0.5px] border-border bg-elevated p-3.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Sparkles size={14} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-[18px] text-ink">{title}</div>
          <div className="mt-0.5 text-[12px] leading-4 text-ink-secondary" title={subtitle}>
            {subtitle}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("updates.problem.dismiss")}
          title={t("updates.problem.dismiss")}
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 touch:size-11"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      {s.status === "handed-off" && s.command && (
        <code className="mt-2.5 block overflow-x-auto rounded-lg bg-inset px-2 py-1.5 font-mono text-[11.5px] whitespace-pre text-ink-secondary">
          {s.command}
        </code>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDismiss}
          disabled={pending !== null}
          className={PILL}
        >
          {s.status === "handed-off" || s.retryable === false ? t("updates.problem.dismiss") : t("releaseNotes.later")}
        </button>
        {s.status === "error" && s.retryable !== false && (
          <button
            type="button"
            onClick={onRetry}
            disabled={pending !== null}
            className={PRIMARY_PILL}
          >
            {pending === "check" ? (
              <>
                <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> {t("common.checking")}
              </>
            ) : (
              t("updates.problem.retry")
            )}
          </button>
        )}
        {s.status === "error" && s.retryable === false && (
          // The native staging failed and cannot be retried in place; the
          // only remedy is to quit and reopen, so keep that control clickable.
          <button type="button" onClick={onQuit} className={PRIMARY_PILL}>
            {t("settings.updates.quitReopen")}
          </button>
        )}
      </div>
    </div>
  );
}
