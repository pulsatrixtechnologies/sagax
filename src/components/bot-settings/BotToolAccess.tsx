// Tool access of this bot (2026-10-15, formerly Settings > General >
// Advanced with a bot picker): its grants beyond the default tool access,
// with Grant and Revoke, for the bot that is open. Owner or admin. 2026-10-26:
// the owner grants every tier within their own environment; a scope that
// reaches past it (adminOnlyAreas) stays an admin's. An admin-tier grant
// always ends within 30 days (server/routes/bot-runtime-settings.ts,
// docs/tool-policy.md).
import { useCallback, useEffect, useState } from "react";

import { t, activeLocale } from "@/lib/i18n";
import { botToolGrantsPath } from "@/lib/bot-runtime-settings";
import { botGrantRequest, grantTier, sortGrants, type GrantDraft, type ToolGrantRow } from "@/lib/tool-grants";
import { api, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { PaneSection, usePaneRows } from "./PaneSection";
import { PILL, PLAIN_FIELD, PillSelect, useSettingsSurface } from "../SettingsPrimitives";

const STATE_KEY = {
  active: "settings.toolAccess.state.active",
  expired: "settings.toolAccess.state.expired",
  revoked: "settings.toolAccess.state.revoked",
} as const;

export function BotToolAccess({ bot }: { bot: Bot }) {
  const [rows, setRows] = useState<ToolGrantRow[] | null>(null);
  const [mayGrantAdmin, setMayGrantAdmin] = useState(false);
  const [adminOnlyAreas, setAdminOnlyAreas] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const paneRows = usePaneRows();

  const load = useCallback(async () => {
    try {
      const body = await api<{ grants: ToolGrantRow[]; mayGrantAdmin?: boolean; adminOnlyAreas?: string[] }>(botToolGrantsPath(bot.id));
      setRows(sortGrants(body.grants));
      setMayGrantAdmin(body.mayGrantAdmin === true);
      setAdminOnlyAreas(Array.isArray(body.adminOnlyAreas) ? body.adminOnlyAreas : []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.toolAccess.error"));
    }
  }, [bot.id]);
  useEffect(() => { void load(); }, [load]);

  const revoke = async (id: string) => {
    if (busy) return;
    setBusy(id);
    try {
      await api(botToolGrantsPath(bot.id, id), { method: "POST", body: "{}" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.toolAccess.error"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <PaneSection data-bot-tool-access="" title={t("settings.toolAccess.title")} help={t("botPanel.toolAccess.help")}>
      {error && !rows ? <p className="text-[13px] text-danger">{error}</p>
        : !rows ? <p className="text-[13px] text-ink-secondary">{t("settings.toolAccess.loading")}</p>
          : (
            <div className="flex flex-col gap-3">
              <GrantForm botId={bot.id} mayGrantAdmin={mayGrantAdmin} onGranted={load} />
              {adminOnlyAreas.length > 0 && <p className="text-[12px] text-ink-secondary" data-tool-access-org-areas="">{t("botPanel.toolAccess.orgAreas", { areas: adminOnlyAreas.join(", ") })}</p>}
              {error && <p className="text-[13px] text-danger">{error}</p>}
              {!rows.length ? <p className="text-[13px] text-ink-secondary">{t("botPanel.toolAccess.empty")}</p> : (
                <ul className={paneRows.plain ? "-mx-4 flex flex-col" : "-mx-3.5 flex flex-col divide-y divide-hairline/40 border-t border-hairline/40"} aria-label={t("settings.toolAccess.title")}>
                  {rows.map((row) => (
                    <li key={row.id} className={cn("flex items-center justify-between gap-3 py-2", paneRows.plain && "min-h-[56px]", paneRows.row)}>
                      <div className="min-w-0">
                        <div className={paneRows.plain ? "text-[14px] leading-5 text-ink" : "text-[13px] font-medium text-ink"}><code>{row.scope}</code></div>
                        <div className="text-[12px] text-ink-secondary">
                          {t(STATE_KEY[row.state])}
                          {row.expiresAt && row.state === "active" ? ` · ${t("settings.toolAccess.expires", { date: new Date(row.expiresAt).toLocaleDateString(activeLocale()) })}` : ""}
                        </div>
                        {grantTier(row.scope) === "admin" && row.state === "active" && (
                          <div className="text-[12px] text-danger">{t("settings.toolAccess.adminWarning")}</div>
                        )}
                      </div>
                      {row.state === "active" && (
                        <button type="button" className={PILL} disabled={busy !== null} onClick={() => void revoke(row.id)}>
                          {t("settings.toolAccess.revoke")}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
    </PaneSection>
  );
}

function GrantForm({ botId, mayGrantAdmin, onGranted }: { botId: string; mayGrantAdmin: boolean; onGranted: () => Promise<void> }) {
  const [draft, setDraft] = useState<Omit<GrantDraft, "botId">>({ area: "agents", tier: "write", days: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Omit<GrantDraft, "botId">>) => { setDraft((d) => ({ ...d, ...patch })); setError(""); };
  const submit = async () => {
    if (saving) return;
    const request = botGrantRequest(draft, Date.now());
    if (!request.ok) { setError(t(request.error)); return; }
    setSaving(true);
    try {
      await api(botToolGrantsPath(botId), { method: "POST", body: JSON.stringify(request.body) });
      setDraft((d) => ({ ...d, days: "" }));
      await onGranted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.toolAccess.error"));
    } finally {
      setSaving(false);
    }
  };
  // the bot's profile page (#2313): filled fields, no outline
  const plain = useSettingsSurface() === "plain";
  const field = plain ? cn(PLAIN_FIELD, "h-7 min-h-0 px-2 py-0") : "h-7 rounded-lg border-[0.5px] border-border bg-inset px-2 text-[13px] text-ink focus:border-focus focus:outline-none";
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label={t("settings.toolAccess.form.title")}>
      <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">{t("settings.toolAccess.form.area")}
        <input className={cn(field, "w-[110px]")} value={draft.area} onChange={(e) => set({ area: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">{t("settings.toolAccess.form.tier")}
        <PillSelect<GrantDraft["tier"]>
          value={draft.tier}
          ariaLabel={t("settings.toolAccess.form.tier")}
          onChange={(tier) => set({ tier })}
          options={[
            { value: "read", label: t("settings.toolAccess.tier.read") },
            { value: "write", label: t("settings.toolAccess.tier.write") },
            ...(mayGrantAdmin ? [{ value: "admin" as const, label: t("settings.toolAccess.tier.admin") }] : []),
          ]}
        />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">{t("settings.toolAccess.form.days")}
        <input className={cn(field, "w-[70px]")} inputMode="numeric" value={draft.days} onChange={(e) => set({ days: e.target.value })} />
      </label>
      <button type="submit" disabled={saving} className={PILL}>{t("settings.toolAccess.form.grant")}</button>
      {draft.tier === "admin" && <p className="w-full text-[12px] text-danger">{t("settings.toolAccess.adminWarning")}</p>}
      {!mayGrantAdmin && <p className="w-full text-[12px] text-ink-secondary">{t("botPanel.toolAccess.adminOnly")}</p>}
      {error && <p className="w-full text-[12px] text-danger">{error}</p>}
    </form>
  );
}
