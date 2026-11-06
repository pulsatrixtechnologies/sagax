import { useCallback, useEffect, useState } from "react";

import { confirmAsync, type ConfirmRequest } from "@/components/ConfirmProvider";
import { t, activeLocale } from "@/lib/i18n";
import { grantTier, sortGrants, type ToolGrantRow } from "@/lib/tool-grants";
import type { OrgDirectoryPerson } from "@/lib/perspicax-org";
import { api } from "@/state/store";
import { CountPill, DANGER_PILL, DescribedRow, SettingsGroup } from "./SettingsPrimitives";

const STATE_KEY = {
  active: "settings.toolAccess.state.active",
  expired: "settings.toolAccess.state.expired",
  revoked: "settings.toolAccess.state.revoked",
} as const;

function defaultConfirm(request: ConfirmRequest | string): Promise<boolean> {
  if (typeof request === "string") {
    return confirmAsync({ title: request, confirmLabel: t("common.confirm"), tone: "danger" });
  }
  return confirmAsync(request);
}

/** Settings > General > Advanced: the tool grants given to people (B3b).
 * A bot's own grants moved to its editor, under Permissions (2026-10-15, 
 * bot-settings/BotToolAccess.tsx). Sagax has no form for a person's grant
 * (they come through POST /api/tool-grants), so this card shows only when
 * some exist, for review and Revoke. Admins only; the server refuses
 * anyone else, and the card then stays away. */
export function PeopleToolAccessSettings({ confirm = defaultConfirm }: { confirm?: (req: ConfirmRequest | string) => Promise<boolean> } = {}) {
  const [rows, setRows] = useState<ToolGrantRow[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const body = await api<{ grants: ToolGrantRow[] }>("/api/tool-grants?kind=user");
      setRows(sortGrants(body.grants.filter((row) => row.subject.kind === "user")));
      setError("");
    } catch {
      setRows([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // A person by name where the organization's directory answers (Perspicax);
  // elsewhere the grant's own subject stays, shortened.
  useEffect(() => {
    if (!rows?.length) return;
    let alive = true;
    api<{ people?: OrgDirectoryPerson[] }>("/api/org/directory")
      .then((body) => { if (alive) setNames(Object.fromEntries((body.people ?? []).map((person) => [person.principalId, person.name]))); })
      .catch(() => {});
    return () => { alive = false; };
  }, [rows?.length]);

  const who = (id: string) => names[id] ?? (id.length > 12 ? `${id.slice(0, 11)}…` : id);
  const what = (scope: string) => `${scope.split(":")[0]} · ${t(`settings.toolAccess.tier.${grantTier(scope)}`)}`;

  const revoke = async (row: ToolGrantRow) => {
    if (busy) return;
    if (!(await confirm({
      title: t("settings.toolAccess.revokeConfirm", { name: who(row.subject.id), scope: what(row.scope) }),
      confirmLabel: t("common.confirm"),
      tone: "danger",
    }))) return;
    setBusy(row.id);
    try {
      await api(`/api/tool-grants/${encodeURIComponent(row.id)}/revoke`, { method: "POST", body: "{}" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.toolAccess.error"));
    } finally {
      setBusy(null);
    }
  };

  if (!rows?.length) return null;
  // 0.5.6: one Grok-style row (its count pill unfolds the grants);
  // Revoke is a red pill that asks first.
  return (
    <SettingsGroup advanced title={t("settings.toolAccess.people.title")} groupId="peopleToolAccess">
      <div data-settings-card="general.peopleToolAccess">
        <DescribedRow
          label={t("settings.toolAccess.people.grants")}
          rowId="peopleToolAccess"
          description={error ? <span role="alert" className="text-danger">{error}</span> : t("settings.toolAccess.people.subtitle")}
          below={open && (
            <ul className="mt-2 flex flex-col gap-0.5" aria-label={t("settings.toolAccess.people.title")}>
              {rows.map((row) => (
                <li key={row.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-hover">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] text-ink">{who(row.subject.id)} · {what(row.scope)}</div>
                    <div className="text-[12px] text-ink-secondary">
                      {t(STATE_KEY[row.state])}
                      {row.expiresAt && row.state === "active" ? ` · ${t("settings.toolAccess.expires", { date: new Date(row.expiresAt).toLocaleDateString(activeLocale()) })}` : ""}
                    </div>
                  </div>
                  {row.state === "active" && (
                    <button type="button" className={`${DANGER_PILL} min-h-[44px] md:min-h-0`} disabled={busy !== null} onClick={() => void revoke(row)}>
                      {t("settings.toolAccess.revoke")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        >
          <CountPill count={rows.length} open={open} label={t("settings.toolAccess.people.title")} onToggle={() => setOpen((value) => !value)} />
        </DescribedRow>
      </div>
    </SettingsGroup>
  );
}
