// Settings > Security: the person's security keys and passkeys, and which
// approvals need one (shared/step-up.ts). #2080 L2: add creates first then
// names inline; the seven classes fold under one "Ask for a key for" row
// with HelpTip hints.
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
import { DescribedRow, FIELD, PILL, PRIMARY_PILL, SettingsGroup, SettingsNotice, Switch } from "./SettingsPrimitives";
import { DisclosurePill } from "./settings/AppearanceSettings";
import { readableError } from "@/lib/plain-error";

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
  return readableError(error);
}

function code(error: unknown): string | undefined {
  if (error instanceof StepUpError) return error.code;
  const body = (error as { body?: { code?: unknown } } | null)?.body;
  return typeof body?.code === "string" ? body.code : undefined;
}

/** A short default name from this device, before the person renames the key. */
export function defaultSecurityKeyName(): string {
  if (typeof navigator === "undefined") return t("security.keys.defaultName");
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  if (/iPhone|iPad/.test(ua)) return t("security.keys.device.iphone");
  if (/Android/.test(ua)) return t("security.keys.device.android");
  if (/Mac|Macintosh/.test(platform) || /Mac OS/.test(ua)) return t("security.keys.device.mac");
  if (/Win/.test(platform) || /Windows/.test(ua)) return t("security.keys.device.windows");
  return t("security.keys.defaultName");
}

export function SecurityKeySettings() {
  const [state, setState] = useState<SecurityKeysState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [namingId, setNamingId] = useState<string | null>(null);
  const [namingValue, setNamingValue] = useState("");
  const [classesOpen, setClassesOpen] = useState(false);
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
    const before = new Set((state?.keys ?? []).map((key) => key.id));
    const controller = new AbortController();
    waiting.current = controller;
    setInBrowser(securityKeyInBrowser());
    const ok = await run(async () => {
      await registerSecurityKey(defaultSecurityKeyName(), controller.signal);
    });
    waiting.current = null;
    setInBrowser(false);
    if (ok) {
      const next = await api<SecurityKeysState>("/api/security-keys");
      setState(next);
      const created = next.keys.find((key) => !before.has(key.id));
      if (created) {
        setNamingId(created.id);
        setNamingValue(created.name);
      }
      setNotice(t("security.keys.addedNow"));
    } else if (controller.signal.aborted) {
      void load();
    }
  })();

  const saveName = () => {
    if (!namingId) return;
    const name = namingValue.trim();
    if (!name) return;
    void run(async () => {
      await api(`/api/security-keys/${encodeURIComponent(namingId)}`, { method: "PATCH", body: JSON.stringify({ name }) });
      setNamingId(null);
      setNamingValue("");
    });
  };

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
  const onCount = state?.classes.length ?? 0;
  const totalClasses = STEP_UP_CLASSES.length;

  return (
    <div className="flex min-w-0 flex-col gap-3" data-settings-card="security">
      {error && <SettingsNotice tone="danger">{error}</SettingsNotice>}
      {state?.unreadable && <SettingsNotice tone="danger">{t("security.unreadable")}</SettingsNotice>}
      {notice && <SettingsNotice tone="success">{notice}</SettingsNotice>}

      <div data-settings-card="security.keys">
      <SettingsGroup title={t("security.keys.title")} groupId="security.keys">
        {state?.keys.map((key) => (
          namingId === key.id ? (
            <DescribedRow
              key={key.id}
              rowId={`security-key-${key.id.slice(0, 12)}`}
              icon={<KeyRound size={14} />}
              label={t("security.keys.name")}
              description={t("security.keys.nameAfterAdd")}
            >
              <input
                className={cn(FIELD, "w-[160px]")}
                value={namingValue}
                maxLength={80}
                aria-label={t("security.keys.name")}
                autoFocus
                disabled={busy}
                onChange={(event) => setNamingValue(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") saveName(); }}
              />
              <button type="button" className={PRIMARY_PILL} disabled={busy || !namingValue.trim()} onClick={saveName}>
                {t("security.keys.saveName")}
              </button>
            </DescribedRow>
          ) : (
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
          )
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
            description={noAddress ? t("security.stepUp.noAddress") : (typeof window !== "undefined" && !window.isSecureContext ? t("security.keys.httpsNote") : undefined)}
          >
            <button type="button" className={PRIMARY_PILL} disabled={busy || !usable || !state} onClick={add}>
              {t("security.keys.addButton")}
            </button>
          </DescribedRow>
        )}

        <DescribedRow
          label={t("security.classes.askFor")}
          description={hasKey
            ? t("security.classes.summary", { on: onCount, total: totalClasses })
            : t("security.classes.needKey")}
          rowId="security-classes"
          help={!hasKey ? undefined : (hasKey && !keyHere ? t("security.classes.noKeyHere") : undefined)}
          below={classesOpen && hasKey ? (
            <div className="mt-2 flex flex-col" data-security-classes="">
              {STEP_UP_CLASSES.map((value) => (
                <DescribedRow
                  key={value}
                  label={t(CLASS_LABEL[value])}
                  help={t(CLASS_HINT[value])}
                  rowId={`security-class-${value}`}
                >
                  <Switch
                    checked={Boolean(state?.classes.includes(value))}
                    aria-label={t(CLASS_LABEL[value])}
                    disabled={busy || !state || (!hasKey && !state.classes.includes(value))}
                    onClick={() => toggle(value, !state?.classes.includes(value))}
                  />
                </DescribedRow>
              ))}
            </div>
          ) : undefined}
        >
          {hasKey && (
            <DisclosurePill open={classesOpen} onToggle={() => setClassesOpen((value) => !value)} label={t("security.classes.askFor")}>
              {classesOpen ? t("settings.appearance.hide") : t("security.classes.choose")}
            </DisclosurePill>
          )}
        </DescribedRow>
      </SettingsGroup>
      </div>
    </div>
  );
}
