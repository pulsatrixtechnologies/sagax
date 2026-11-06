// The person's own tool access (server/routes/my-tool-grants.ts). #2080 L2:
// human scope labels ("Agents · write"), form folded under Add access, raw
// scope only in a HelpTip.
import { useCallback, useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { botGrantRequest, grantTier, sortGrants, type GrantDraft, type ToolGrantRow } from "@/lib/tool-grants";
import { readableErrorMessage } from "@/lib/readable-error";
import { api } from "@/state/store";
import { DescribedRow, HelpTip, PILL, PRIMARY_PILL, PillSelect, SettingsGroup } from "../SettingsPrimitives";
import { DisclosurePill } from "./AppearanceSettings";

const PATH = "/api/me/tool-grants";
const STATE_KEY = {
  active: "settings.toolAccess.state.active",
  expired: "settings.toolAccess.state.expired",
  revoked: "settings.toolAccess.state.revoked",
} as const;

const KNOWN_AREAS = ["agents", "memory", "skills", "tools", "messages", "billing", "people", "settings"] as const;

/** Human label for a scope like agents:write → "Agents · Write". Unknown
 * areas keep a title-cased area name; the raw scope stays in a HelpTip. */
export function scopeLabel(scope: string): string {
  const [areaRaw, tierRaw] = scope.split(":");
  const area = (areaRaw ?? "").trim().toLowerCase();
  const tier = (tierRaw ?? "write") as GrantDraft["tier"];
  const known = KNOWN_AREAS.find((entry) => entry === area);
  const areaLabel = known
    ? t(`myToolAccess.scope.${known}`)
    : area ? area.charAt(0).toUpperCase() + area.slice(1) : scope;
  const tierLabel = t(`settings.toolAccess.tier.${tier === "read" || tier === "write" || tier === "admin" ? tier : "write"}`);
  return t("myToolAccess.scopeLine", { area: areaLabel, level: tierLabel });
}

export function MyToolGrants() {
  const [rows, setRows] = useState<ToolGrantRow[] | null>(null);
  const [adminOnlyAreas, setAdminOnlyAreas] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Omit<GrantDraft, "botId">>({ area: "agents", tier: "write", days: "" });

  const load = useCallback(async () => {
    try {
      const body = await api<{ grants: ToolGrantRow[]; adminOnlyAreas?: string[] }>(PATH);
      setRows(sortGrants(body.grants));
      setAdminOnlyAreas(Array.isArray(body.adminOnlyAreas) ? body.adminOnlyAreas : []);
      setError("");
    } catch (cause) {
      setRows(null);
      setError(readableErrorMessage(cause, t("settings.toolAccess.error")));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      await load();
    } catch (cause) {
      setError(readableErrorMessage(cause, t("settings.toolAccess.error")));
    } finally {
      setBusy(false);
    }
  };
  const grant = () => {
    const request = botGrantRequest(draft, Date.now());
    if (!request.ok) { setError(t(request.error)); return; }
    void run(async () => {
      await api(PATH, { method: "POST", body: JSON.stringify(request.body) });
      setDraft((d) => ({ ...d, days: "" }));
      setAdding(false);
    });
  };
  if (!rows) return null;
  const field = "h-7 rounded-lg border-[0.5px] border-border bg-inset px-2 text-[13px] text-ink focus:border-focus focus:outline-none";
  return (
    <div data-settings-card="myToolAccess">
    <SettingsGroup title={t("myToolAccess.title")} groupId="myToolAccess"
      accessory={<HelpTip label={t("settings.moreAbout", { title: t("myToolAccess.title") })}>{t("myToolAccess.help")}</HelpTip>}>
      <div className="flex flex-col" data-my-tool-access={String(rows.length)}>
        {rows.length === 0 ? (
          <p className="px-3.5 py-2.5 text-[13px] text-ink-secondary">{t("myToolAccess.empty")}</p>
        ) : (
          rows.map((row) => {
            const expires = row.expiresAt && row.state === "active"
              ? t("myToolAccess.expiresIn", {
                days: Math.max(1, Math.ceil((row.expiresAt - Date.now()) / 86_400_000)),
              })
              : null;
            const description = [t(STATE_KEY[row.state]), expires].filter(Boolean).join(" · ");
            return (
              <div key={row.id}>
                <DescribedRow
                  label={scopeLabel(row.scope)}
                  description={description}
                  help={row.scope}
                  rowId={`tool-grant-${row.id.slice(0, 12)}`}
                >
                  {row.state === "active" && (
                    <button type="button" className={PILL} disabled={busy} onClick={() => void run(() => api(`${PATH}/${row.id}/revoke`, { method: "POST", body: "{}" }))}>
                      {t("settings.toolAccess.revoke")}
                    </button>
                  )}
                </DescribedRow>
                {grantTier(row.scope) === "admin" && row.state === "active" && (
                  <p className="px-3.5 pb-2 text-[12px] text-danger">{t("settings.toolAccess.adminWarning")}</p>
                )}
              </div>
            );
          })
        )}
        {adminOnlyAreas.length > 0 && <p className="px-3.5 pb-2 text-[12px] text-ink-secondary">{t("botPanel.toolAccess.orgAreas", { areas: adminOnlyAreas.join(", ") })}</p>}
        {error && <p role="alert" className="px-3.5 pb-2 text-[12px] text-danger">{error}</p>}
        <DescribedRow
          label={t("myToolAccess.add")}
          rowId="tool-grant-add"
          below={adding ? (
            <form
              className="mt-2 flex flex-wrap items-end gap-2"
              onSubmit={(e) => { e.preventDefault(); grant(); }}
              aria-label={t("settings.toolAccess.form.title")}
              data-tool-grant-form=""
            >
              <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">{t("settings.toolAccess.form.area")}
                <PillSelect
                  value={draft.area}
                  ariaLabel={t("settings.toolAccess.form.area")}
                  onChange={(area) => { setDraft((d) => ({ ...d, area })); setError(""); }}
                  options={KNOWN_AREAS.map((area) => ({ value: area, label: t(`myToolAccess.scope.${area}`) }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">{t("settings.toolAccess.form.tier")}
                <PillSelect<GrantDraft["tier"]>
                  value={draft.tier}
                  ariaLabel={t("settings.toolAccess.form.tier")}
                  onChange={(tier) => { setDraft((d) => ({ ...d, tier })); setError(""); }}
                  options={[
                    { value: "read", label: t("settings.toolAccess.tier.read") },
                    { value: "write", label: t("settings.toolAccess.tier.write") },
                    { value: "admin", label: t("settings.toolAccess.tier.admin") },
                  ]}
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">{t("settings.toolAccess.form.days")}
                <input className={`${field} w-[70px]`} inputMode="numeric" value={draft.days} onChange={(e) => { setDraft((d) => ({ ...d, days: e.target.value })); setError(""); }} />
              </label>
              <button type="submit" disabled={busy} className={PRIMARY_PILL}>{t("settings.toolAccess.form.grant")}</button>
              {draft.tier === "admin" && <p className="basis-full text-[12px] text-danger">{t("settings.toolAccess.adminWarning")}</p>}
            </form>
          ) : undefined}
        >
          <DisclosurePill open={adding} onToggle={() => setAdding((value) => !value)} label={t("myToolAccess.add")}>
            {adding ? t("settings.appearance.hide") : t("myToolAccess.addAction")}
          </DisclosurePill>
        </DescribedRow>
      </div>
    </SettingsGroup>
    </div>
  );
}
