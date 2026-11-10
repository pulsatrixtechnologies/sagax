// Shared vault of a team bot: managers add logins the bot fills by handle.
// Values never appear in the list or in chat (server/routes/team-bot-vault.ts).
import { useCallback, useEffect, useState, type RefObject } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { api, type Bot, type ConfigStatus } from "@/state/store";
import { canSetBotHost, viewerOwnsBot } from "@/lib/bot-capabilities";
import type { VaultItemListing } from "../../../shared/credential-vault";
import { DescribedRow, HelpTip, PILL as PLAIN_PILL, PLAIN_FIELD, SettingsGroup, useSettingsSurface } from "../SettingsPrimitives";

const FIELD = "w-full rounded-lg border border-hairline/60 bg-inset px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent/50";
const PILL = "rounded-full border border-hairline/60 px-2.5 py-1 text-[12px] text-ink hover:bg-hover disabled:opacity-50";
const PRIMARY = "rounded-full bg-accent px-2.5 py-1 text-[12px] text-accent-ink disabled:opacity-50";

/** A new login of the shared vault, as the form fills it. */
export interface TeamVaultLogin {
  name: string;
  username: string;
  password: string;
  /** "a.com, b.com": split on spaces and commas */
  domains: string;
}

/** Whether this viewer is offered the shared vault of a bot: a bot shared
 * with someone, and a viewer who owns it or may change where it runs. */
export function teamVaultOffered(
  config: ConfigStatus | null | undefined,
  bot: Pick<Bot, "grants" | "directGrants" | "ownerUserId">,
): boolean {
  return Boolean(bot.grants?.length || bot.directGrants?.length) && (viewerOwnsBot(config, bot) || canSetBotHost(config, bot));
}

/** The shared vault of one bot: its logins (never a value), add and
 * remove. `enabled` false reads nothing (the vault is not offered). */
export function useTeamBotVault(botId: string, enabled = true) {
  const [items, setItems] = useState<VaultItemListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  useEffect(() => { if (enabled) void load(); }, [load, enabled]);

  /** true once saved; false when the server refused (the error says why) */
  const add = async (login: TeamVaultLogin): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/bots/${botId}/credentials`, {
        method: "POST",
        body: JSON.stringify({
          kind: "login",
          name: login.name.trim() || "Shared login",
          username: login.username.trim(),
          password: login.password,
          domains: login.domains.split(/[\s,]+/).map((row) => row.trim()).filter(Boolean),
        }),
      });
      await load();
      return true;
    } catch (failure) {
      setError(readableError(failure));
      return false;
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

  return { items, error, busy, add, remove };
}

/** A login's grey line: its sites, and whether a password is saved. */
export function teamVaultLine(item: VaultItemListing): string {
  return `${item.domains.join(", ") || t("botPanel.teamVault.noSite")}${item.hasPassword ? ` · ${t("botPanel.teamVault.hasPassword")}` : ""}`;
}

/** The form of a new login: name, sites, username, password; Save needs a
 * site and a password. `plain` is the profile page's look. */
export function TeamVaultForm({ busy, plain, onSave, onCancel, firstFieldRef, className }: {
  busy: boolean;
  plain: boolean;
  onSave: (login: TeamVaultLogin) => Promise<boolean>;
  onCancel: () => void;
  firstFieldRef?: RefObject<HTMLInputElement | null>;
  className?: string;
}) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [domains, setDomains] = useState("");
  const field = plain ? PLAIN_FIELD : FIELD;
  const save = (
    <button type="submit" className={plain ? PLAIN_PILL : PRIMARY} disabled={busy || !domains.trim() || !password}>{t("botPanel.teamVault.save")}</button>
  );
  const cancel = <button type="button" className={plain ? PLAIN_PILL : PILL} disabled={busy} onClick={onCancel}>{t("botPanel.teamVault.cancel")}</button>;
  return (
    <form
      data-team-vault-form=""
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({ name, username, password, domains }).then((saved) => {
          if (!saved) return;
          setName("");
          setUsername("");
          setPassword("");
          setDomains("");
        });
      }}
    >
      <input ref={firstFieldRef} className={field} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("botPanel.teamVault.name")} aria-label={t("botPanel.teamVault.name")} />
      <input className={field} value={domains} onChange={(event) => setDomains(event.target.value)} placeholder={t("botPanel.teamVault.sites")} aria-label={t("botPanel.teamVault.sites")} autoComplete="off" />
      <input className={field} value={username} onChange={(event) => setUsername(event.target.value)} placeholder={t("botPanel.teamVault.username")} aria-label={t("botPanel.teamVault.username")} autoComplete="off" />
      <input className={field} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("botPanel.teamVault.password")} aria-label={t("botPanel.teamVault.password")} autoComplete="new-password" />
      <div className={plain ? "flex justify-end gap-2" : "flex gap-2"}>
        {plain ? <>{cancel}{save}</> : <>{save}{cancel}</>}
      </div>
    </form>
  );
}

export function TeamBotVaultSection({ botId, botName }: { botId: string; botName: string }) {
  const { items, error, busy, add: save, remove } = useTeamBotVault(botId);
  const [adding, setAdding] = useState(false);
  const plain = useSettingsSurface() === "plain";
  const add = async (login: TeamVaultLogin) => {
    const saved = await save(login);
    if (saved) setAdding(false);
    return saved;
  };

  // The bot's profile page (#2313): the reference look. The grey label
  // carries the title, its help and the Add pill; the logins are rows of
  // one plain card (icon, name, sites, Remove pill); the form opens in the
  // card with filled fields and plain pills.
  if (plain) {
    const title = t("botPanel.teamVault.title");
    return (
      <div data-settings-card="bot.teamVault">
        <SettingsGroup
          title={title}
          groupId="botTeamVault"
          accessory={<>
            <HelpTip label={t("settings.moreAbout", { title })}>{t("botPanel.teamVault.help", { bot: botName })}</HelpTip>
            {!adding && (
              <button type="button" className={cn(PLAIN_PILL, "ml-auto shrink-0 gap-1")} disabled={busy} onClick={() => setAdding(true)}>
                <Plus size={13} aria-hidden="true" /> {t("botPanel.teamVault.add")}
              </button>
            )}
          </>}
        >
          <div data-settings-row="teamVault" className="flex flex-col">
            {items && items.length > 0 && (
              <ul className="flex flex-col" aria-label={title}>
                {items.map((item) => (
                  <li key={item.id} className="flex min-h-[56px] items-center gap-3 px-4 py-2.5">
                    <KeyRound aria-hidden="true" className="size-5 shrink-0 text-ink-secondary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] leading-5 text-ink">{item.name}</p>
                      <p className="truncate text-[12px] leading-4 text-ink-secondary">{teamVaultLine(item)}</p>
                    </div>
                    <button type="button" className={cn(PLAIN_PILL, "shrink-0")} disabled={busy} onClick={() => void remove(item.id)} aria-label={t("botPanel.teamVault.remove")} title={t("botPanel.teamVault.remove")}>
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {items && !items.length && !adding && (
              <p className="px-4 py-2.5 text-[12px] leading-4 text-ink-secondary">{t("botPanel.teamVault.empty")}</p>
            )}
            {adding && <TeamVaultForm plain busy={busy} onSave={add} onCancel={() => setAdding(false)} className="flex flex-col gap-2 px-4 py-2.5" />}
            {error && <p className="px-4 pb-2 text-[12px] text-danger" role="alert">{error}</p>}
          </div>
        </SettingsGroup>
      </div>
    );
  }

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
                <p className="truncate text-[11.5px] text-ink-secondary">{teamVaultLine(item)}</p>
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
        <TeamVaultForm plain={false} busy={busy} onSave={add} onCancel={() => setAdding(false)} className="flex flex-col gap-2 rounded-xl border border-hairline/50 bg-inset p-3" />
      ) : (
        <button type="button" className={cn(PILL, "self-start inline-flex items-center gap-1")} disabled={busy} onClick={() => setAdding(true)}>
          <Plus size={12} /> {t("botPanel.teamVault.add")}
        </button>
      )}
    </div>
  );
}
