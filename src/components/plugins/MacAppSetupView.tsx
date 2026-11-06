// Plugins > This Mac > Mail, Calendar, Contacts, Reminders or Notes: the same
// setup page as Messages (MessagesSetupView): what bots can do, the macOS
// permission with its Open System Settings button, a test, the On/Off switch.
// Solo reads the local server; an organization server reads this Mac over IPC.
// Never blank: loading, then the page or a readable error with Retry.
import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, RotateCw, Shield, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { automationAction, permissionTone } from "@/lib/mac-messages-setup";
import {
  askMacAppAutomation,
  loadMacApps,
  openMacAppPermissionPane,
  setMacAppEnabled,
  testMacApp,
  type MacAppSetupId,
  type MacAppsSetupStatus,
  type MacAppTestResult,
} from "@/lib/mac-apps-setup";
import { SwitchRow } from "../SettingsPrimitives";
import { PluginPageHeader } from "./PluginParts";
import { MAC_APP_LOOK, macAppName } from "./MacAppsView";
import type { Crumb } from "../Breadcrumb";

type SetupApp = Exclude<MacAppSetupId, "messages">;

/** Each app's own words (en.json literals; the shared ones are below). */
const COPY = {
  mail: {
    intro: "connectApps.mac.mail.intro",
    readTitle: "connectApps.mac.mail.readTitle",
    readBody: "connectApps.mac.mail.readBody",
    writeTitle: "connectApps.mac.mail.writeTitle",
    writeBody: "connectApps.mac.mail.writeBody",
  },
  calendar: {
    intro: "connectApps.mac.calendar.intro",
    readTitle: "connectApps.mac.calendar.readTitle",
    readBody: "connectApps.mac.calendar.readBody",
    writeTitle: "connectApps.mac.calendar.writeTitle",
    writeBody: "connectApps.mac.calendar.writeBody",
  },
  contacts: {
    intro: "connectApps.mac.contacts.intro",
    readTitle: "connectApps.mac.contacts.readTitle",
    readBody: "connectApps.mac.contacts.readBody",
    writeTitle: null,
    writeBody: null,
  },
  reminders: {
    intro: "connectApps.mac.reminders.intro",
    readTitle: "connectApps.mac.reminders.readTitle",
    readBody: "connectApps.mac.reminders.readBody",
    writeTitle: "connectApps.mac.reminders.writeTitle",
    writeBody: "connectApps.mac.reminders.writeBody",
  },
  notes: {
    intro: "connectApps.mac.notes.intro",
    readTitle: "connectApps.mac.notes.readTitle",
    readBody: "connectApps.mac.notes.readBody",
    writeTitle: "connectApps.mac.notes.writeTitle",
    writeBody: "connectApps.mac.notes.writeBody",
  },
} as const;

export function macAppTitle(app: SetupApp): string {
  return t("connectApps.mac.app.title", { app: macAppName(app) });
}

function StatusDot({ tone }: { tone: "ok" | "warn" | "todo" }) {
  const cls = tone === "ok" ? "bg-success text-white" : tone === "warn" ? "bg-danger text-white" : "border border-hairline/60 bg-panel text-ink-secondary";
  return (
    <span className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px]", cls)} aria-hidden="true">
      {tone === "ok" ? <Check size={12} strokeWidth={3} /> : tone === "warn" ? <X size={12} strokeWidth={3} /> : null}
    </span>
  );
}

function permissionLabel(state: string): string {
  if (state === "granted") return t("connectApps.mac.messages.perm.granted");
  if (state === "denied") return t("connectApps.mac.messages.perm.denied");
  if (state === "notAsked") return t("connectApps.mac.messages.perm.notAsked");
  if (state === "unsupported") return t("connectApps.mac.messages.perm.unsupported");
  return t("connectApps.mac.messages.perm.unknown");
}

export function MacAppSetupView({ app, onBack, trail, initial }: {
  app: SetupApp;
  onBack: () => void;
  trail: Crumb[];
  /** Gallery and tests: a status instead of loading one. */
  initial?: MacAppsSetupStatus;
}) {
  const [status, setStatus] = useState<MacAppsSetupStatus | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "enable" | "test" | "open" | "ask" | null>(initial ? null : "load");
  const [testError, setTestError] = useState<string | null>(null);
  const [test, setTest] = useState<MacAppTestResult | null>(null);
  const [testFailed, setTestFailed] = useState(false);

  const load = useCallback(async (quiet: boolean) => {
    if (!quiet) { setBusy("load"); setError(null); }
    try {
      setStatus(await loadMacApps());
      if (!quiet) setError(null);
    } catch (cause) {
      if (!quiet) setError(readableError(cause));
    } finally {
      if (!quiet) setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (!initial) void load(false);
  }, [initial, load]);

  useEffect(() => {
    if (initial) return undefined;
    const onFocus = () => { void load(true); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [initial, load]);

  const row = status?.apps.find((candidate) => candidate.id === app);
  const automation = row?.permissions.automation ?? "unknown";
  const enabled = row?.enabled === true;
  const copy = COPY[app];
  const look = MAC_APP_LOOK[app];
  const Icon = look.icon;
  const name = macAppName(app);

  const run = async (kind: "enable" | "test" | "open" | "ask", work: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(null);
    }
  };

  const toggle = (next: boolean) => run("enable", async () => {
    if (!status) return;
    const previous = status;
    setStatus({ ...status, apps: status.apps.map((candidate) => (candidate.id === app ? { ...candidate, enabled: next } : candidate)) });
    try {
      setStatus(await setMacAppEnabled(app, next));
    } catch (cause) {
      setStatus(previous);
      throw cause;
    }
  });

  // The read error shows under the test itself, apart from the permission.
  const runTest = () => run("test", async () => {
    setTest(null);
    setTestFailed(false);
    setTestError(null);
    try {
      setTest(await testMacApp(app));
    } catch (cause) {
      setTestFailed(true);
      setTestError(readableError(cause));
    } finally {
      await load(true);
    }
  });

  // "Ask for access": macOS shows its prompt naming Sagax for this app.
  const askAccess = () => run("ask", async () => {
    setStatus(await askMacAppAutomation(app));
  });

  const autoTone = automation === "granted" ? "ok" : automation === "denied" ? "warn" : "todo";
  const testTone = test ? "ok" : testFailed ? "warn" : "todo";
  const button = "mt-2 inline-flex items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised disabled:opacity-50";

  return (
    <>
      <PluginPageHeader title={macAppTitle(app)} trail={trail} onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-7 pt-3 sm:px-8" data-mac-app-setup={app}>
        {busy === "load" && !status && (
          <div className="flex items-center gap-2 text-[12.5px] text-ink-secondary" data-mac-app-loading="">
            <Loader2 size={14} className="animate-spin" /> {t("connectApps.mac.app.loading", { app: name })}
          </div>
        )}

        {!status && busy !== "load" && error && (
          <div className="rounded-[14px] border-[0.5px] border-ink/10 bg-ink/[0.015] px-4 py-4" data-mac-app-load-error="">
            <p className="text-[13px] font-medium text-ink">{t("connectApps.mac.loadFailed")}</p>
            <p role="alert" className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{error}</p>
            <button type="button" className={button} onClick={() => void load(false)}>
              <RotateCw size={13} aria-hidden="true" /> {t("connectApps.mac.retry")}
            </button>
          </div>
        )}

        {status && !status.available && (
          <div className="rounded-[14px] border-[0.5px] border-ink/10 bg-ink/[0.015] px-4 py-4" data-mac-app-unavailable="">
            <p className="text-[13px] font-medium text-ink">{t("connectApps.mac.app.unavailableTitle", { app: name })}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{t("connectApps.mac.app.unavailableBody")}</p>
          </div>
        )}

        {status?.available && (
          <div className="flex flex-col gap-5">
            <section className="rounded-[14px] border-[0.5px] border-ink/10 bg-ink/[0.015] px-4 py-4" data-mac-app-intro="">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: look.tile }}>
                  <Icon size={20} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold text-ink">{t("connectApps.mac.app.headline", { app: name })}</h2>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{t(copy.intro)}</p>
                </div>
              </div>
              <ul className="mt-4 space-y-3">
                <li className="rounded-xl bg-inset px-3 py-2.5">
                  <p className="text-[13px] font-medium text-ink">{t(copy.readTitle)}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t(copy.readBody)}</p>
                </li>
                {copy.writeTitle && copy.writeBody && (
                  <li className="rounded-xl bg-inset px-3 py-2.5">
                    <p className="text-[13px] font-medium text-ink">{t(copy.writeTitle)}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t(copy.writeBody)}</p>
                  </li>
                )}
              </ul>
            </section>

            <section className="rounded-[14px] border-[0.5px] border-ink/10 bg-ink/[0.015] px-4 py-4" data-mac-app-steps="">
              <div className="mb-3 flex items-center gap-2">
                <Shield size={15} className="text-ink-secondary" aria-hidden="true" />
                <h3 className="text-[13px] font-semibold text-ink">{t("connectApps.mac.messages.stepsTitle")}</h3>
              </div>
              <p className="mb-3 text-[12px] leading-relaxed text-ink-secondary">{t("connectApps.mac.messages.stepsHelp")}</p>

              <ol className="space-y-3">
                <li className="flex gap-3" data-mac-app-step="automation" data-mac-app-step-state={autoTone}>
                  <StatusDot tone={autoTone} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[13px] font-medium text-ink">{t("connectApps.mac.app.automationTitle", { app: name })}</p>
                      <span className={cn("text-[11.5px]", permissionTone(automation) === "ok" ? "text-success" : permissionTone(automation) === "warn" ? "text-danger" : "text-ink-secondary")}>
                        {permissionLabel(automation)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t("connectApps.mac.app.automationBody", { app: name })}</p>
                    {automationAction(automation) === "ask" && (
                      <>
                        <button type="button" data-mac-app-ask-automation disabled={busy !== null} onClick={() => void askAccess()} className={button}>
                          {busy === "ask" && <Loader2 size={13} className="animate-spin" />}
                          {t("connectApps.mac.askAccess")}
                        </button>
                        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-secondary">{t("connectApps.mac.askAccessHelp")}</p>
                      </>
                    )}
                    {automationAction(automation) === "openSettings" && (
                      <>
                        <p className="mt-1.5 text-[11.5px] leading-relaxed text-danger" data-mac-app-automation-denied="">{t("connectApps.mac.deniedHelp")}</p>
                        <button type="button" data-mac-app-open-automation disabled={busy !== null} onClick={() => void run("open", () => openMacAppPermissionPane("automation"))} className={button}>
                          {busy === "open" && <Loader2 size={13} className="animate-spin" />}
                          {t("connectApps.mac.messages.openSettings")}
                        </button>
                      </>
                    )}
                  </div>
                </li>

                <li className="flex gap-3" data-mac-app-step="test" data-mac-app-step-state={testTone}>
                  <StatusDot tone={testTone} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-ink">{t("connectApps.mac.messages.testTitle")}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t("connectApps.mac.app.testBody", { app: name })}</p>
                    <button type="button" data-mac-app-test disabled={busy !== null} onClick={() => void runTest()} className={button}>
                      {busy === "test" && <Loader2 size={13} className="animate-spin" />}
                      {t("connectApps.mac.messages.testRun")}
                    </button>
                    {testError && (
                      <p role="alert" className="mt-2 text-[12px] leading-relaxed text-danger" data-mac-app-test-error="">
                        {t("connectApps.mac.readFailed", { error: testError })}
                      </p>
                    )}
                    {test && (
                      <p className="mt-2 text-[12.5px] text-ink" data-mac-app-test-result="" data-mac-app-test-count={test.count}>
                        {test.count === 1 ? t("connectApps.mac.app.testResultOne") : t("connectApps.mac.app.testResultMany", { count: test.count })}
                      </p>
                    )}
                  </div>
                </li>

                <li className="flex gap-3" data-mac-app-step="enable" data-mac-app-step-state={enabled ? "ok" : "todo"}>
                  <StatusDot tone={enabled ? "ok" : "todo"} />
                  <div className="min-w-0 flex-1">
                    <SwitchRow
                      label={t("connectApps.mac.app.enable", { app: name })}
                      description={t("connectApps.mac.app.enableHelp", { app: name })}
                      checked={enabled}
                      disabled={busy === "enable"}
                      onChange={(next) => void toggle(next)}
                    />
                    <p className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary">{t("connectApps.mac.app.enableNote")}</p>
                  </div>
                </li>
              </ol>
            </section>
          </div>
        )}

        {status && error && <p role="alert" className="mt-3 text-[12px] text-danger">{error}</p>}
      </div>
    </>
  );
}
