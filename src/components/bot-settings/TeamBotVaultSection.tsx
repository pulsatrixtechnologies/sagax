// Shared vault of a team bot: managers add logins the bot fills by handle.
// Values never appear in the list or in chat (server/routes/team-bot-vault.ts).
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { api } from "@/state/store";
import type { VaultItemListing } from "../../../shared/credential-vault";
import { DescribedRow } from "../SettingsPrimitives";

const FIELD = "w-full rounded-lg border border-hairline/60 bg-inset px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent/50";
const PILL = "rounded-full border border-hairline/60 px-2.5 py-1 text-[12px] text-ink hover:bg-hover disabled:opacity-50";
const PRIMARY = "rounded-full bg-accent px-2.5 py-1 text-[12px] text-accent-ink disabled:opacity-50";

export function TeamBotVaultSection({ botId, botName }: { botId: string; botName: string }) {
  const [items, setItems] = useState<VaultItemListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [domains, setDomains] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const body = await api<{ items: VaultItemListing[] }>(`/api/bots/${botId}/credentials/list`, { method: "POST", body: "{}" });
      setItems(body.items);
    } catch (failure) {
      setItems([]);
      setError(readableError(failure));
    }
  }, [botId]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/bots/${botId}/credentials`, {
        method: "POST",
        body: JSON.stringify({
          kind: "login",
          name: name.trim() || "Shared login",
          username: username.trim(),
          password,
          domains: domains.split(/[\s,]+/).map((row) => row.trim()).filter(Boolean),
        }),
      });
      setAdding(false);
      setName("");
      setUsername("");
      setPassword("");
      setDomains("");
      await load();
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
      await api(`/api/bots/${botId}/credentials/${id}`, { method: "DELETE" });
      await load();
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-settings-card="bot.teamVault" className="flex flex-col gap-2">
      <DescribedRow
        label={t("botPanel.teamVault.title")}
        help={t("botPanel.teamVault.help", { bot: botName })}
        rowId="teamVault"
      >
        <KeyRound size={14} className="text-ink-tertiary" aria-hidden />
      </DescribedRow>
      {error && <p className="text-[12px] text-danger" role="alert">{error}</p>}
      {items && items.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={t("botPanel.teamVault.title")}>
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-hairline/40 bg-elevated px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] text-ink">{item.name}</p>
                <p className="truncate text-[11.5px] text-ink-secondary">
                  {item.domains.join(", ") || t("botPanel.teamVault.noSite")}
                  {item.hasPassword ? ` · ${t("botPanel.teamVault.hasPassword")}` : ""}
                </p>
              </div>
              <button type="button" className={PILL} disabled={busy} onClick={() => void remove(item.id)} aria-label={t("botPanel.teamVault.remove")}>
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {items && !items.length && !adding && (
        <p className="text-[12px] text-ink-secondary">{t("botPanel.teamVault.empty")}</p>
      )}
      {adding ? (
        <form
          className="flex flex-col gap-2 rounded-xl border border-hairline/50 bg-inset p-3"
          onSubmit={(event) => { event.preventDefault(); void add(); }}
        >
          <input className={FIELD} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("botPanel.teamVault.name")} aria-label={t("botPanel.teamVault.name")} />
          <input className={FIELD} value={domains} onChange={(event) => setDomains(event.target.value)} placeholder={t("botPanel.teamVault.sites")} aria-label={t("botPanel.teamVault.sites")} autoComplete="off" />
          <input className={FIELD} value={username} onChange={(event) => setUsername(event.target.value)} placeholder={t("botPanel.teamVault.username")} aria-label={t("botPanel.teamVault.username")} autoComplete="off" />
          <input className={FIELD} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("botPanel.teamVault.password")} aria-label={t("botPanel.teamVault.password")} autoComplete="new-password" />
          <div className="flex gap-2">
            <button type="submit" className={PRIMARY} disabled={busy || !domains.trim() || !password}>{t("botPanel.teamVault.save")}</button>
            <button type="button" className={PILL} disabled={busy} onClick={() => setAdding(false)}>{t("botPanel.teamVault.cancel")}</button>
          </div>
        </form>
      ) : (
        <button type="button" className={cn(PILL, "self-start inline-flex items-center gap-1")} disabled={busy} onClick={() => setAdding(true)}>
          <Plus size={12} /> {t("botPanel.teamVault.add")}
        </button>
      )}
    </div>
  );
}
