// The Automations page's scope control and filters (2026-10-09): Mine,
// My teams and Everyone, then Team, Owner and Status. My teams needs
// routines.viewTeam and Everyone routines.viewAll (an admin holds both);
// without the key the choice stays visible, disabled, and its tooltip names
// the missing permission. Simple mode keeps the scope control, and under
// Mine the Owner filter too (#1676: Me vs shared bots). The server decides
// what each scope answers (server/routines/routine-scope.ts).
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { personLabel } from "@/lib/human-label";
import { permissionMissingText } from "@/lib/permissions";
import {
  ROUTINE_SCOPE_PERMISSION,
  ROUTINE_SCOPE_STATUSES,
  ROUTINE_SCOPES,
  type RoutineScope,
  type RoutineScopeChoice,
} from "../../../shared/routine-scope";
import type { RoutineScopePrefs } from "@/lib/routine-scope-prefs";

const SCOPE_LABEL = {
  mine: "routines.scope.mine",
  team: "routines.scope.team",
  all: "routines.scope.all",
} as const;

const STATUS_LABEL = {
  active: "routines.scope.status.active",
  paused: "routines.scope.status.paused",
  failing: "routines.scope.status.failing",
} as const;

const SELECT = "max-w-[180px] rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong";

export function RoutineScopeBar({ prefs, allowed, teams, owners, advanced, hideStatus = false, stacked = false, viewerPrincipalId = null, onChange }: {
  prefs: RoutineScopePrefs;
  allowed: Record<RoutineScope, boolean>;
  teams: readonly RoutineScopeChoice[];
  owners: readonly RoutineScopeChoice[];
  /** Simple mode: scope control, plus Owner under Mine. */
  advanced: boolean;
  /** Calendar view: it shows plans, not run results, so no status filter. */
  hideStatus?: boolean;
  /** Inside the Automations Filters popover: one control per line, full
   * width; the popover carries the one Clear filters. */
  stacked?: boolean;
  /** The viewer's principal id: Owner offers "Me" under Mine (#1676). */
  viewerPrincipalId?: string | null;
  onChange: (next: RoutineScopePrefs) => void;
}) {
  const scope = allowed[prefs.scope] ? prefs.scope : "mine";
  const meId = viewerPrincipalId?.trim() || "";
  const meKey = meId.toLowerCase();
  const otherOwners = meKey ? owners.filter((owner) => owner.id.toLowerCase() !== meKey) : owners;
  // Mine always offers Owner (Me / shared owners). Wider scopes keep it in
  // advanced mode only, as before.
  const showOwner = scope === "mine"
    ? Boolean(meId || owners.length > 0)
    : advanced && owners.length > 0;
  const filtered = Boolean(prefs.teamId || prefs.ownerId || (advanced && !hideStatus && prefs.status));
  return (
    <div data-routine-scope-bar className={cn("flex gap-2", stacked ? "flex-col items-stretch" : "flex-wrap items-center")}>
      <div role="radiogroup" aria-label={t("routines.scope.label")} className={cn("flex items-center rounded-lg border border-hairline/50 bg-panel p-0.5", stacked && "w-full")}>
        {ROUTINE_SCOPES.map((value) => {
          const permitted = allowed[value];
          const missing = value === "mine" || permitted ? undefined : permissionMissingText(ROUTINE_SCOPE_PERMISSION[value]);
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={scope === value}
              data-routine-scope={value}
              disabled={!permitted}
              title={missing}
              onClick={() => permitted && onChange({ ...prefs, scope: value, ...(value === "mine" ? { teamId: undefined } : {}) })}
              className={cn(
                "rounded-md px-3 py-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-45",
                stacked && "flex-1 whitespace-nowrap px-2",
                scope === value ? "bg-raised text-ink" : "text-ink-secondary hover:text-ink",
              )}
            >
              {t(SCOPE_LABEL[value])}
            </button>
          );
        })}
      </div>
      {showOwner && (
        <select aria-label={t("routines.scope.ownerFilter")} data-routine-filter="owner" value={prefs.ownerId ?? ""} onChange={(event) => onChange({ ...prefs, ownerId: event.target.value || undefined })} className={cn(SELECT, stacked && "w-full max-w-none")}>
          <option value="">{t("routines.scope.allOwners")}</option>
          {meId && <option value={meId}>{t("routines.scope.ownerMe")}</option>}
          {otherOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
        </select>
      )}
      {advanced && scope !== "mine" && teams.length > 0 && (
        <select aria-label={t("routines.scope.teamFilter")} data-routine-filter="team" value={prefs.teamId ?? ""} onChange={(event) => onChange({ ...prefs, teamId: event.target.value || undefined })} className={cn(SELECT, stacked && "w-full max-w-none")}>
          <option value="">{t("routines.scope.allTeams")}</option>
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      )}
      {advanced && !hideStatus && (
        <select aria-label={t("routines.scope.statusFilter")} data-routine-filter="status" value={prefs.status ?? ""} onChange={(event) => onChange({ ...prefs, status: (event.target.value || undefined) as RoutineScopePrefs["status"] })} className={cn(SELECT, stacked && "w-full max-w-none")}>
          <option value="">{t("routines.scope.anyStatus")}</option>
          {ROUTINE_SCOPE_STATUSES.map((status) => <option key={status} value={status}>{t(STATUS_LABEL[status])}</option>)}
        </select>
      )}
      {filtered && !stacked && (
        <button type="button" data-routine-filter-reset onClick={() => onChange({ scope: prefs.scope, ...(prefs.botId ? { botId: prefs.botId } : {}) })} className="rounded-lg px-2 py-1.5 text-[12px] text-accent hover:underline">
          {t("routines.scope.reset")}
        </button>
      )}
    </div>
  );
}

/** The owner of someone else's routine: their avatar (or initials) and name. */
export function RoutineOwnerBadge({ owner, size = 16, className }: { owner: { id: string; name: string; avatarUrl?: string }; size?: number; className?: string }) {
  const name = personLabel(owner.name, owner.id);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
  return (
    <span data-routine-owner={owner.id} title={t("routines.scope.ownedBy", { name })} className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      {owner.avatarUrl
        ? <img src={owner.avatarUrl} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
        : <span aria-hidden="true" className="flex shrink-0 items-center justify-center rounded-full bg-raised font-medium text-ink-secondary" style={{ width: size, height: size, fontSize: Math.max(8, size * 0.45) }}>{initials}</span>}
      <span className="truncate">{name}</span>
    </span>
  );
}
