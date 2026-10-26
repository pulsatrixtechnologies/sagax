// Who this bot is shared with, on a server signed in with Perspicax (slices
// 3 and 4): people and teams from the organization directory, each at a
// level (Talk, Run routines, Edit, Manage sharing). The grants are the gate
// there (VisibilitySection is hidden): a person or team added sees the bot
// and its conversations; removing them narrows their lists and live updates
// at once (server side). The editor shows to whoever may administer the
// grants (the owner, manage holders, organization admins, team managers
// for their teams), from GET /api/bots/:id/grants.
import { cn } from "@/lib/cn";
import { GROUP_CARD } from "../SettingsPrimitives";
import { useEffect, useMemo, useState } from "react";

import { api, useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import type { GrantAdministration, OrgDirectory, WireGrant } from "@/lib/perspicax-org";
import { GrantEditor } from "./GrantEditor";
import { viewerCan } from "@/lib/viewer";
import { permissionMissingText } from "@/lib/permissions";
import { personLabel } from "@/lib/human-label";
import { readableOr } from "../../../shared/human-id";

/** The grants the bot carries, as the editor's first rows (labels come from
 * the directory once it answers; the server's answer replaces them). */
export function initialGrantRows(bot: Pick<Bot, "grants" | "directGrants" | "ownerUserId">, directory: OrgDirectory | null): WireGrant[] {
  const byId = new Map((directory?.people ?? []).map((person) => [person.principalId.toLowerCase(), person]));
  const teams = new Map((directory?.teams ?? []).map((team) => [team.id, team]));
  const grants = bot.grants ?? (bot.directGrants ?? []).map((id) => ({ target: `user:${id}`, level: "use" as const, by: bot.ownerUserId ?? "", at: 0 }));
  return grants.map((grant) => {
    const team = grant.target.startsWith("team:");
    const id = grant.target.slice(5);
    const person = team ? undefined : byId.get(id.toLowerCase());
    return {
      ...grant,
      kind: team ? "team" as const : "user" as const,
      label: team ? readableOr(teams.get(id)?.name ?? id, t("ids.deletedTeam")) : personLabel(person?.name, id),
      ...(person?.disabled ? { disabled: true } : {}),
    };
  });
}

export function SharingSection({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const viewerId = state.config?.viewer?.principalId ?? null;
  const isOwner = Boolean(viewerId && bot.ownerUserId && viewerId.toLowerCase() === bot.ownerUserId.toLowerCase());
  const [directory, setDirectory] = useState<OrgDirectory | null>(null);

  useEffect(() => {
    let alive = true;
    void api<OrgDirectory>("/api/org/directory")
      .then((body) => { if (alive) setDirectory({ people: body.people ?? [], teams: body.teams ?? [], ...(body.viewer ? { viewer: body.viewer } : {}) }); })
      .catch(() => { if (alive) setDirectory({ people: [], teams: [] }); });
    return () => { alive = false; };
  }, [bot.id]);

  const rows = useMemo(() => initialGrantRows(bot, directory), [bot, directory]);
  // 2026-10-09: an owner whose profile lacks sharing.grants sees the
  // grants without the editor's controls, and why.
  const mayShare = viewerCan(state.config, "sharing.grants");
  const ownerAdminister: GrantAdministration | null = isOwner && mayShare ? { any: true, teamIds: [], maxLevel: "manage", canAdd: true } : null;

  return (
    <div className="flex flex-col gap-3" data-bot-sharing>
      <p className="text-[12.5px] leading-relaxed text-ink-secondary">{t("botSettings.sharing.notice")}</p>
      {isOwner && !mayShare && <p role="note" data-sharing-permission className="text-[12.5px] leading-relaxed text-ink-secondary">{permissionMissingText("sharing.grants")}</p>}
      {/* Settings' card (2026-10-16) */}
      <div className={cn(GROUP_CARD, "px-3.5 py-2.5")}>
        <GrantEditor
          key={`${bot.id}:${directory ? "directory" : "loading"}`}
          botId={bot.id}
          ownerId={bot.ownerUserId}
          initialGrants={rows}
          initialAdminister={ownerAdminister}
          directory={directory}
        />
      </div>
    </div>
  );
}
