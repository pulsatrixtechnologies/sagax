// Settings > Organization, admins only: team secrets live in the Perspicax
// organization's vault (server/org-bot-secrets.ts). A saved secret is a
// label and an assignment. The value is typed once and never shown again.
// Members do not get this section, and the server answers them 403.
import { useCallback, useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { botLabel } from "@/lib/human-label";
import { api, useStore } from "@/state/store";
import type { OrgBotSecretPublic } from "../../../shared/org-bot-secrets";
import { FIELD, PILL, PRIMARY_PILL, SettingsGroup, SettingsNotice, SettingsTextRow } from "../SettingsPrimitives";

const inputClass = FIELD;

export function OrgTeamSecrets() {
  const { state } = useStore();
  const [secrets, setSecrets] = useState<OrgBotSecretPublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [envName, setEnvName] = useState("");
  const [botId, setBotId] = useState("");
  const [kind, setKind] = useState<"secret" | "serviceAccount">("secret");
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const body = await api<{ secrets: OrgBotSecretPublic[] }>("/api/org/bot-secrets");
      setSecrets(body.secrets);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = await api<{ secrets: OrgBotSecretPublic[] }>("/api/org/bot-secrets", {
        method: "POST",
        body: JSON.stringify({
          op: "add", kind, label, value, botIds: [botId],
          injection: { via: "env", name: envName },
          ...(kind === "serviceAccount" ? { login } : {}),
        }),
      });
      setSecrets(body.secrets);
      setValue("");
      setLabel("");
      setLogin("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const body = await api<{ secrets: OrgBotSecretPublic[] }>("/api/org/bot-secrets", {
        method: "POST",
        body: JSON.stringify({ op: "remove", id }),
      });
      setSecrets(body.secrets);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (id: string) => botLabel(state.bots.find((bot) => bot.id === id)?.name, id);

  return (
    <div data-settings-card="organization.teamSecrets">
      <SettingsGroup title={t("orgSecrets.title")} groupId="organization.teamSecrets">
        <SettingsTextRow>{t("orgSecrets.intro")}</SettingsTextRow>
        {error && <SettingsNotice tone="danger">{error}</SettingsNotice>}
        {(secrets ?? []).map((secret) => (
          <div key={secret.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5" data-org-secret={secret.label}>
            <div className="min-w-0 text-[13px] text-ink">
              {secret.label}
              <span className="ms-2 text-[12px] text-ink-secondary">
                {secret.kind === "serviceAccount" ? t("orgSecrets.serviceAccount") : t("orgSecrets.secret")}
                {secret.injection.via === "env" ? ` · ${secret.injection.name}` : ""}
                {secret.login ? ` · ${secret.login}` : ""}
                {` · ${secret.botIds.map(nameOf).join(", ")}`}
              </span>
            </div>
            <button type="button" className={PILL} disabled={busy} onClick={() => void remove(secret.id)}>{t("orgSecrets.remove")}</button>
          </div>
        ))}
        {secrets && !secrets.length && <SettingsTextRow>{t("orgSecrets.empty")}</SettingsTextRow>}
        <div className="flex flex-col gap-2 px-3.5 py-2.5">
          <select aria-label={t("orgSecrets.kind")} className={inputClass} value={kind} onChange={(event) => setKind(event.target.value === "serviceAccount" ? "serviceAccount" : "secret")}>
            <option value="secret">{t("orgSecrets.secret")}</option>
            <option value="serviceAccount">{t("orgSecrets.serviceAccount")}</option>
          </select>
          <input className={inputClass} value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t("orgSecrets.label")} aria-label={t("orgSecrets.label")} />
          {kind === "serviceAccount" && <input className={inputClass} value={login} onChange={(event) => setLogin(event.target.value)} placeholder={t("orgSecrets.login")} aria-label={t("orgSecrets.login")} autoComplete="off" />}
          <input className={inputClass} dir="ltr" value={envName} onChange={(event) => setEnvName(event.target.value)} placeholder={t("orgSecrets.env")} aria-label={t("orgSecrets.env")} autoComplete="off" spellCheck={false} />
          <input className={inputClass} dir="ltr" type="password" value={value} onChange={(event) => setValue(event.target.value)} placeholder={t("orgSecrets.value")} aria-label={t("orgSecrets.value")} autoComplete="off" spellCheck={false} />
          <select aria-label={t("orgSecrets.bot")} className={inputClass} value={botId} onChange={(event) => setBotId(event.target.value)}>
            <option value="">{t("orgSecrets.bot")}</option>
            {state.bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
          </select>
          <div className="flex justify-end">
            <button type="button" className={PRIMARY_PILL} disabled={busy || !label || !value || !envName || !botId} onClick={() => void add()}>{t("orgSecrets.add")}</button>
          </div>
        </div>
      </SettingsGroup>
    </div>
  );
}
