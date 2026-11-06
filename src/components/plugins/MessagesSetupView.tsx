// Connect apps > Mac > Messages: setup for iMessage/SMS on this Mac.
// Structure matches Grok Bot's Mac Messages surface; Sagax words and mascot.
import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, MessageSquare, RotateCw, Shield, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import {
  loadMessagesSetup,
  openMessagesPermissionPane,
  permissionTone,
  setMessagesEnabled,
  testMessagesSetup,
  type MessagesSetupStatus,
  type MessagesSetupTestResult,
} from "@/lib/mac-messages-setup";
import { messagesStepState } from "../../../shared/mac-messages-setup.ts";
import { SwitchRow } from "../SettingsPrimitives";
import { PluginPageHeader } from "./PluginParts";
import type { Crumb } from "../Breadcrumb";

type Props = {
  onBack: () => void;
  trail: Crumb[];
};

function StatusDot({ tone }: { tone: "ok" | "warn" | "muted" | "todo" }) {
  const cls =
    tone === "ok" ? "bg-success text-white"
    : tone === "warn" ? "bg-danger text-white"
    : tone === "todo" ? "border border-hairline/60 bg-panel text-ink-secondary"
    : "bg-inset text-ink-secondary";
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

export function MessagesSetupView({ onBack, trail }: Props) {
  const [status, setStatus] = useState<MessagesSetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "enable" | "test" | "open" | null>("load");
  const [test, setTest] = useState<MessagesSetupTestResult | null>(null);
  const [tested, setTested] = useState(false);
  const [testOk, setTestOk] = useState(false);

  // Refresh after an action or on focus: a failure keeps the page and only
  // replaces a blank one by the readable error (never an unhandled reject).
  const refresh = useCallback(async () => {
    try {
      const next = await loadMessagesSetup();
      setStatus(next);
      return next;
    } catch (cause) {
      setStatus((current) => {
        if (!current) setError(readableError(cause));
        return current;
      });
      return null;
    }
  }, []);

  const load = useCallback(async () => {
    setBusy("load");
    setError(null);
    try {
      setStatus(await loadMessagesSetup());
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  const openPane = async (pane: "fullDiskAccess" | "automation") => {
    setBusy("open");
    setError(null);
    try {
      await openMessagesPermissionPane(pane);
      await refresh();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    setBusy("test");
    setError(null);
    try {
      const result = await testMessagesSetup();
      setTest(result);
      setTested(true);
      setTestOk(true);
      await refresh();
    } catch (cause) {
      setTested(true);
      setTestOk(false);
      setError(readableError(cause));
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (next: boolean) => {
    if (!status) return;
    setBusy("enable");
    setError(null);
    const previous = status.useMessages;
    setStatus({ ...status, useMessages: next });
    try {
      const saved = await setMessagesEnabled(next);
      setStatus(saved);
    } catch (cause) {
      setStatus({ ...status, useMessages: previous });
      setError(readableError(cause));
    } finally {
      setBusy(null);
    }
  };

  const permissions = status?.permissions ?? { fullDiskAccess: "unknown", automation: "unknown" };
  const useMessages = status?.useMessages === true;
  const fdaState = messagesStepState({ step: "fullDiskAccess", permissions, useMessages, tested, testOk });
  const autoState = messagesStepState({ step: "automation", permissions, useMessages, tested, testOk });
  const testState = messagesStepState({ step: "test", permissions, useMessages, tested, testOk });
  const enableState = messagesStepState({ step: "enable", permissions, useMessages, tested, testOk });

  const stepTone = (state: typeof fdaState): "ok" | "warn" | "muted" | "todo" => {
    if (state === "done") return "ok";
    if (state === "blocked") return "warn";
    if (state === "waiting") return "muted";
    return "todo";
  };

  return (
    <>
      <PluginPageHeader title={t("connectApps.mac.messages.title")} trail={trail} onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-7 pt-3 sm:px-8" data-messages-setup="">
        {busy === "load" && !status && (
          <div className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
            <Loader2 size={14} className="animate-spin" /> {t("connectApps.mac.messages.loading")}
          </div>
        )}

        {status && !status.available && (
          <div className="rounded-[14px] border-[0.5px] border-ink/10 bg-ink/[0.015] px-4 py-4" data-messages-setup-unavailable="">
            <p className="text-[13px] font-medium text-ink">{t("connectApps.mac.messages.unavailableTitle")}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">
              {status.reason === "organization_server"
                ? t("connectApps.mac.messages.unavailableOrg")
                : status.reason === "not_darwin"
                  ? t("connectApps.mac.messages.unavailablePlatform")
                  : t("connectApps.mac.messages.unavailableGeneric")}
            </p>
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink-secondary">{t("connectApps.mac.messages.useOnMac")}</p>
          </div>
        )}

        {status?.available && (
          <div className="flex flex-col gap-5">
            <section className="rounded-[14px] border-[0.5px] border-ink/10 bg-ink/[0.015] px-4 py-4" data-messages-setup-intro="">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
                  <MessageSquare size={20} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold text-ink">{t("connectApps.mac.messages.headline")}</h2>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{t("connectApps.mac.messages.intro")}</p>
                </div>
              </div>
              <ul className="mt-4 space-y-3">
                <li className="rounded-xl bg-inset px-3 py-2.5">
                  <p className="text-[13px] font-medium text-ink">{t("connectApps.mac.messages.readTitle")}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t("connectApps.mac.messages.readBody")}</p>
                </li>
                <li className="rounded-xl bg-inset px-3 py-2.5">
                  <p className="text-[13px] font-medium text-ink">{t("connectApps.mac.messages.sendTitle")}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t("connectApps.mac.messages.sendBody")}</p>
                </li>
              </ul>
            </section>

            <section className="rounded-[14px] border-[0.5px] border-ink/10 bg-ink/[0.015] px-4 py-4" data-messages-setup-steps="">
              <div className="mb-3 flex items-center gap-2">
                <Shield size={15} className="text-ink-secondary" aria-hidden="true" />
                <h3 className="text-[13px] font-semibold text-ink">{t("connectApps.mac.messages.stepsTitle")}</h3>
              </div>
              <p className="mb-3 text-[12px] leading-relaxed text-ink-secondary">{t("connectApps.mac.messages.stepsHelp")}</p>

              <ol className="space-y-3">
                <li className="flex gap-3" data-messages-step="fullDiskAccess" data-messages-step-state={fdaState}>
                  <StatusDot tone={stepTone(fdaState)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[13px] font-medium text-ink">{t("connectApps.mac.messages.fdaTitle")}</p>
                      <span className={cn("text-[11.5px]", permissionTone(permissions.fullDiskAccess) === "ok" ? "text-success" : permissionTone(permissions.fullDiskAccess) === "warn" ? "text-danger" : "text-ink-secondary")}>
                        {permissionLabel(permissions.fullDiskAccess)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t("connectApps.mac.messages.fdaBody")}</p>
                    {permissions.fullDiskAccess !== "granted" && (
                      <button
                        type="button"
                        data-messages-open-fda
                        disabled={busy !== null}
                        onClick={() => void openPane("fullDiskAccess")}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised disabled:opacity-50"
                      >
                        {busy === "open" && <Loader2 size={13} className="animate-spin" />}
                        {t("connectApps.mac.messages.openSettings")}
                      </button>
                    )}
                  </div>
                </li>

                <li className="flex gap-3" data-messages-step="automation" data-messages-step-state={autoState}>
                  <StatusDot tone={stepTone(autoState)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[13px] font-medium text-ink">{t("connectApps.mac.messages.automationTitle")}</p>
                      <span className={cn("text-[11.5px]", permissionTone(permissions.automation) === "ok" ? "text-success" : permissionTone(permissions.automation) === "warn" ? "text-danger" : "text-ink-secondary")}>
                        {permissionLabel(permissions.automation)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t("connectApps.mac.messages.automationBody")}</p>
                    {permissions.automation !== "granted" && (
                      <button
                        type="button"
                        data-messages-open-automation
                        disabled={busy !== null}
                        onClick={() => void openPane("automation")}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised disabled:opacity-50"
                      >
                        {busy === "open" && <Loader2 size={13} className="animate-spin" />}
                        {t("connectApps.mac.messages.openSettings")}
                      </button>
                    )}
                  </div>
                </li>

                <li className="flex gap-3" data-messages-step="test" data-messages-step-state={testState}>
                  <StatusDot tone={stepTone(testState)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-ink">{t("connectApps.mac.messages.testTitle")}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t("connectApps.mac.messages.testBody")}</p>
                    <button
                      type="button"
                      data-messages-test
                      disabled={busy !== null || permissions.fullDiskAccess !== "granted"}
                      onClick={() => void runTest()}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised disabled:opacity-50"
                    >
                      {busy === "test" && <Loader2 size={13} className="animate-spin" />}
                      {t("connectApps.mac.messages.testRun")}
                    </button>
                    {test && (
                      <p className="mt-2 text-[12.5px] text-ink" data-messages-test-result="" data-messages-conversation-count={test.conversationCount}>
                        {test.conversationCount === 1
                          ? t("connectApps.mac.messages.testResultOne")
                          : t("connectApps.mac.messages.testResultMany", { count: test.conversationCount })}
                      </p>
                    )}
                  </div>
                </li>

                <li className="flex gap-3" data-messages-step="enable" data-messages-step-state={enableState}>
                  <StatusDot tone={stepTone(enableState)} />
                  <div className="min-w-0 flex-1">
                    <SwitchRow
                      label={t("connectApps.mac.messages.enable")}
                      description={t("connectApps.mac.messages.enableHelp")}
                      checked={useMessages}
                      disabled={busy === "enable"}
                      onChange={(next) => void toggle(next)}
                    />
                    <p className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary">{t("connectApps.mac.messages.enableNote")}</p>
                  </div>
                </li>
              </ol>
            </section>
          </div>
        )}

        {!status && busy !== "load" && (
          <div className="rounded-[14px] border-[0.5px] border-ink/10 bg-ink/[0.015] px-4 py-4" data-messages-load-error="">
            <p className="text-[13px] font-medium text-ink">{t("connectApps.mac.loadFailed")}</p>
            <p role="alert" className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{error ?? t("connectApps.mac.notOnThisMac")}</p>
            <button type="button" onClick={() => void load()} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised">
              <RotateCw size={13} aria-hidden="true" /> {t("connectApps.mac.retry")}
            </button>
          </div>
        )}

        {status && error && <p role="alert" className="mt-3 text-[12px] text-danger">{error}</p>}
      </div>
    </>
  );
}
