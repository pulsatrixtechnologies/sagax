// Settings > Security (wave 2, package E): the person's security keys and
// passkeys, and which approvals need one (shared/step-up.ts). Each person's
// own, on an organization server too. Taking a protection away (a class, a
// key) asks the key itself: the server refuses it otherwise, and the store's
// `api` runs that step-up and sends the change again.
//
// 2026-10-18 (JC): the first key needs a fresh sign-in; the page says so
// before the person tries and offers it (Sign in again: the forced
// Pulsatrix sign-in of src/lib/sign-in-again.ts, then back here,
// src/lib/settings-return.ts; nothing on a server without it). In the desktop app the key is asked in the
// system browser (electron/security-key-browser.mjs): the page waits for it
// and can stop waiting. Laid out as the other pages (grey headings over
// cards of rows, SettingsPrimitives).
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";

import { activeLocale, t } from "@/lib/i18n";
import { rememberSettingsReturn } from "@/lib/settings-return";
import { signInAgainPath } from "@/lib/sign-in-again";
import { StepUpError, registerSecurityKey, securityKeyInBrowser, securityKeysUsable } from "@/lib/step-up-client";
import { api } from "@/state/store";
import type { LocaleKey } from "@/locales";
import { STEP_UP_CLASSES, type SecurityKeysState, type StepUpClass } from "../../shared/step-up";
import { cn } from "@/lib/cn";
import { DescribedRow, FIELD, PILL, PRIMARY_PILL, SettingsGroup, SettingsIntro, SettingsNotice, SettingsTextRow, Switch } from "./SettingsPrimitives";

const CLASS_LABEL: Record<StepUpClass, LocaleKey> = {
  destructive: "security.class.destructive",
  irreversible: "security.class.irreversible",
  money: "security.class.money",
  "external-send": "security.class.externalSend",
  "always-grant": "security.class.alwaysGrant",
  "publish-page": "security.class.publishPage",
  "rule-change": "security.class.ruleChange",
};

const CLASS_HINT: Record<StepUpClass, LocaleKey> = {
  destructive: "security.class.destructive.hint",
  irreversible: "security.class.irreversible.hint",
  money: "security.class.money.hint",
  "external-send": "security.class.externalSend.hint",
  "always-grant": "security.class.alwaysGrant.hint",
  "publish-page": "security.class.publishPage.hint",
  "rule-change": "security.class.ruleChange.hint",
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function code(error: unknown): string | undefined {
  if (error instanceof StepUpError) return error.code;
  const body = (error as { body?: { code?: unknown } } | null)?.body;
  return typeof body?.code === "string" ? body.code : undefined;
}

export function SecurityKeySettings() {
  const [state, setState] = useState<SecurityKeysState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  /** The key is being asked in the system browser. */
  const [inBrowser, setInBrowser] = useState(false);
  /** The sign-in this page asked for is under way (desktop: in the browser). */
  const [signingIn, setSigningIn] = useState(false);
  /** Where "Sign in again" goes; null: no Pulsatrix sign-in on this server. */
  const [againPath, setAgainPath] = useState<string | null | undefined>(undefined);
  const waiting = useRef<AbortController | null>(null);
  const usable = securityKeysUsable();

  const load = useCallback(async () => {
    try {
      setState(await api<SecurityKeysState>("/api/security-keys"));
      setError(null);
    } catch (err) {
      setError(message(err));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => waiting.current?.abort(), []);
  const needsSignIn = Boolean(state?.needsSignIn);
  useEffect(() => {
    if (!needsSignIn) return;
    let live = true;
    void signInAgainPath().then((path) => { if (live) setAgainPath(path); });
    return () => { live = false; };
  }, [needsSignIn]);

  const run = async (work: () => Promise<SecurityKeysState | void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await work();
      if (next) setState(next);
      else await load();
      return true;
    } catch (err) {
      if (code(err) === "reauth_required") {
        // the server's own word: show the sign-in row, not a red line
        setState((current) => (current ? { ...current, needsSignIn: true } : current));
      } else if (code(err) !== "cancelled" || !waiting.current?.signal.aborted) {
        setError(message(err));
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggle = (value: StepUpClass, on: boolean) => {
    if (!state) return;
    const classes = on ? [...state.classes, value] : state.classes.filter((entry) => entry !== value);
    void run(() => api<SecurityKeysState>("/api/security-keys/classes", { method: "PUT", body: JSON.stringify({ classes }) }));
  };

  const add = () => void (async () => {
    const controller = new AbortController();
    waiting.current = controller;
    setInBrowser(securityKeyInBrowser());
    const ok = await run(async () => {
      await registerSecurityKey(name.trim() || t("security.keys.defaultName"), controller.signal);
      setName("");
    });
    waiting.current = null;
    setInBrowser(false);
    if (ok) setNotice(t("security.keys.addedNow"));
    // stopped waiting: the browser may still have added it
    else if (controller.signal.aborted) void load();
  })();

  const stopWaiting = () => waiting.current?.abort();

  const signInAgain = () => {
    if (!againPath) return;
    setSigningIn(true);
    rememberSettingsReturn("security");
    location.assign(againPath);
  };

  const remove = (id: string) => void run(() => api<SecurityKeysState>(`/api/security-keys/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({}) }));

  const hasKey = Boolean(state?.keys.length);
  const date = (at: number) => new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium" }).format(new Date(at));
  const keyHere = state?.rpId ? state.keys.some((key) => key.rpId === state.rpId) : hasKey;
  const noAddress = !usable || (!state?.rpId && !securityKeyInBrowser());

  return (
    <div className="flex min-w-0 flex-col gap-3" data-settings-card="security">
      <SettingsIntro>{t("security.intro")}</SettingsIntro>
      {error && <SettingsNotice tone="danger">{error}</SettingsNotice>}
      {state?.unreadable && <SettingsNotice tone="danger">{t("security.unreadable")}</SettingsNotice>}
      {notice && <SettingsNotice tone="success">{notice}</SettingsNotice>}

      <SettingsGroup title={t("security.keys.title")} groupId="security.keys">
        {state?.keys.map((key) => (
          <DescribedRow
            key={key.id}
            rowId={`security-key-${key.id.slice(0, 12)}`}
            icon={<KeyRound size={14} />}
            label={key.name}
            description={[
              key.deviceType === "multiDevice" ? t("security.keys.passkey") : t("security.keys.hardware"),
              t("security.keys.added", { when: date(key.createdAt) }),
              key.lastUsedAt ? t("security.keys.lastUsed", { when: date(key.lastUsedAt) }) : null,
              state.rpId && key.rpId !== state.rpId ? t("security.keys.otherAddress", { address: key.rpId }) : null,
            ].filter(Boolean).join(" · ")}
          >
            <button type="button" className={PILL} disabled={busy} aria-label={t("security.keys.removeNamed", { name: key.name })} onClick={() => remove(key.id)}>
              <Trash2 size={13} aria-hidden="true" /> {t("security.keys.remove")}
            </button>
          </DescribedRow>
        ))}
        {state && !state.keys.length && <DescribedRow label={t("security.keys.none")} rowId="security-keys-none" />}
        {inBrowser ? (
          <DescribedRow label={t("security.browser.title")} description={t("security.browser.hint")} rowId="security-keys-browser">
            <button type="button" className={PILL} onClick={stopWaiting}>{t("security.browser.cancel")}</button>
          </DescribedRow>
        ) : state?.needsSignIn ? (
          <DescribedRow
            label={t("security.reauth.title")}
            description={signingIn ? t("security.reauth.waiting") : againPath === null ? t("security.reauth.unavailable") : t("security.reauth.hintPulsatrix")}
            rowId="security-keys-reauth"
          >
            {againPath !== null && <button type="button" className={PRIMARY_PILL} disabled={signingIn || !againPath} onClick={signInAgain}>{t("security.reauth.button")}</button>}
          </DescribedRow>
        ) : (
          <DescribedRow
            label={t("security.keys.add")}
            rowId="security-keys-add"
            description={noAddress ? t("security.stepUp.noAddress") : t("security.keys.addHint")}
          >
            <input
              className={cn(FIELD, "w-[160px]")}
              value={name}
              maxLength={80}
              placeholder={t("security.keys.namePlaceholder")}
              aria-label={t("security.keys.name")}
              disabled={busy || !state}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !busy && usable && state) add(); }}
            />
            <button type="button" className={PRIMARY_PILL} disabled={busy || !usable || !state} onClick={add}>
              {t("security.keys.addButton")}
            </button>
          </DescribedRow>
        )}
      </SettingsGroup>

      <SettingsGroup title={t("security.classes.title")} groupId="security.classes">
        <SettingsTextRow>{hasKey ? t("security.classes.intro") : t("security.classes.needKey")}</SettingsTextRow>
        {hasKey && !keyHere && <SettingsTextRow tone="warning">{t("security.classes.noKeyHere")}</SettingsTextRow>}
        {STEP_UP_CLASSES.map((value) => (
          <DescribedRow key={value} label={t(CLASS_LABEL[value])} description={t(CLASS_HINT[value])} rowId={`security-class-${value}`}>
            <Switch
              checked={Boolean(state?.classes.includes(value))}
              aria-label={t(CLASS_LABEL[value])}
              disabled={busy || !state || (!hasKey && !state.classes.includes(value))}
              onClick={() => toggle(value, !state?.classes.includes(value))}
            />
          </DescribedRow>
        ))}
      </SettingsGroup>
    </div>
  );
}
