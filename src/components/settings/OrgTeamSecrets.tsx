// Settings > Organization, admins only: team secrets live in the Perspicax
// organization's vault (server/org/org-bot-secrets.ts). A saved secret is a
// label and an assignment. The value is typed once and never shown again.
// Members do not get this section, and the server answers them 403.
import { useCallback, useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { botLabel } from "@/lib/human-label";
import { api, useStore } from "@/state/store";
import type { OrgBotSecretPublic } from "../../../shared/org-bot-secrets";
import { cn } from "@/lib/cn";
import { DescribedRow, EditorBox, EditorField, FIELD, PILL, PillSelect, PRIMARY_PILL } from "../SettingsPrimitives";
import { readableError } from "@/lib/plain-error";

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
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const body = await api<{ secrets: OrgBotSecretPublic[] }>("/api/org/bot-secrets");
      setSecrets(body.secrets);
      setError(null);
    } catch (failure) {
      setError(readableError(failure));
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
      close();
    } catch (failure) {
      setError(readableError(failure));
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
      setError(readableError(failure));
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (id: string) => botLabel(state.bots.find((bot) => bot.id === id)?.name, id);
  const close = () => {
    setAdding(false);
    setValue("");
    setLabel("");
    setLogin("");
    setEnvName("");
    setBotId("");
    setKind("secret");
  };

  // One row of the Organization's bots card (2026-10-26): the title and
  // what it is at the left, "Add a secret" at the right; the saved secrets
  // as lines under it, and the editor only once asked for.
  return (
    <div data-settings-card="organization.teamSecrets">
      <DescribedRow
        label={t("orgSecrets.title")}
        rowId="teamSecrets"
        description={(
          <>
            {t("orgSecrets.intro")}
            {error && <span role="alert" className="mt-1 block text-danger">{error}</span>}
          </>
        )}
        below={(
          <>
            {secrets && secrets.length > 0 && (
              <ul className="mt-2 flex flex-col" aria-label={t("orgSecrets.title")}>
                {secrets.map((secret) => (
                  <li key={secret.id} className="flex min-w-0 items-center justify-between gap-3 py-1.5" data-org-secret={secret.label}>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] leading-[18px] text-ink">{secret.label}</div>
                      <div className="truncate text-[12px] leading-4 text-ink-secondary">
                        {secret.kind === "serviceAccount" ? t("orgSecrets.serviceAccount") : t("orgSecrets.secret")}
                        {secret.injection.via === "env" ? <> · <span dir="ltr">{secret.injection.name}</span></> : ""}
                        {secret.login ? ` · ${secret.login}` : ""}
                        {` · ${secret.botIds.map(nameOf).join(", ")}`}
                      </div>
                    </div>
                    <button type="button" className={`${PILL} shrink-0`} disabled={busy} onClick={() => void remove(secret.id)}>{t("orgSecrets.remove")}</button>
                  </li>
                ))}
              </ul>
            )}
            {secrets && !secrets.length && !adding && <p className="mt-1 text-[12px] leading-4 text-ink-secondary">{t("orgSecrets.empty")}</p>}
            {adding && (
              <EditorBox
                label={t("orgSecrets.new")}
                className="mt-2"
                data-org-secret-editor=""
                onSubmit={() => { if (!busy && label && value && envName && botId) void add(); }}
                actions={(
                  <>
                    <button type="button" className={PILL} disabled={busy} onClick={close}>{t("common.cancel")}</button>
                    <button type="submit" className={PRIMARY_PILL} disabled={busy || !label || !value || !envName || !botId}>{t("orgSecrets.add")}</button>
                  </>
                )}
              >
                <EditorField label={t("orgSecrets.kind")} menu>
                  <PillSelect
                    ariaLabel={t("orgSecrets.kind")}
                    value={kind}
                    onChange={(next) => setKind(next === "serviceAccount" ? "serviceAccount" : "secret")}
                    options={[
                      { value: "secret", label: t("orgSecrets.secret") },
                      { value: "serviceAccount", label: t("orgSecrets.serviceAccount") },
                    ]}
                  />
                </EditorField>
                <EditorField label={t("orgSecrets.label")}>
                  <input className={FIELD} value={label} onChange={(event) => setLabel(event.target.value)} aria-label={t("orgSecrets.label")} />
                </EditorField>
                {kind === "serviceAccount" && (
                  <EditorField label={t("orgSecrets.login")}>
                    <input className={FIELD} value={login} onChange={(event) => setLogin(event.target.value)} aria-label={t("orgSecrets.login")} autoComplete="off" />
                  </EditorField>
                )}
                <EditorField label={t("orgSecrets.env")}>
                  <input className={cn(FIELD, "font-mono text-[12px]")} dir="ltr" value={envName} onChange={(event) => setEnvName(event.target.value)} placeholder="SHOP_TOKEN" aria-label={t("orgSecrets.env")} autoComplete="off" spellCheck={false} />
                </EditorField>
                <EditorField label={t("orgSecrets.value")}>
                  <input className={FIELD} dir="ltr" type="password" value={value} onChange={(event) => setValue(event.target.value)} aria-label={t("orgSecrets.value")} autoComplete="off" spellCheck={false} />
                </EditorField>
                <EditorField label={t("orgSecrets.bot")} menu>
                  <PillSelect
                    ariaLabel={t("orgSecrets.bot")}
                    value={botId}
                    onChange={setBotId}
                    options={[
                      { value: "", label: t("orgSecrets.bot"), disabled: true },
                      ...state.bots.map((bot) => ({ value: bot.id, label: bot.name })),
                    ]}
                  />
                </EditorField>
              </EditorBox>
            )}
          </>
        )}
      >
        {!adding && (
          <button type="button" className={PILL} disabled={busy} onClick={() => setAdding(true)} data-org-secret-add="">{t("orgSecrets.new")}</button>
        )}
      </DescribedRow>
    </div>
  );
}
