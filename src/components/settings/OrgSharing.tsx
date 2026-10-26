// Settings > Organization > Sharing in the organization (slice 4): the bots
// whose sharing the viewer administers (an admin: every bot; a team
// manager: bots shared with their teams or members; anyone: bots they own or
// manage), their owner and grants, never their messages. One compact row per
// bot (its avatar, owner, how widely it is shared, whether it is working);
// a row opens the same grant editor as the bot's own Sharing section. An
// organization admin also gets "Forcer l'arrêt" and "Forcer la suppression"
// in the row's menu (server/org-bot-force.ts decides; the owner is
// notified); the result shows as a toast.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, MoreHorizontal, Search, Square, Trash2 } from "lucide-react";

import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { OrgDirectory, WireGrant } from "@/lib/perspicax-org";
import { personInitials } from "@/lib/people-dm";
import { personAvatarSrc } from "@/lib/profile-management";
import type { BotPublicProfile } from "../../../shared/bot-public-profile";
import { BotAvatar } from "../Avatar";
import { navigateThreadMenu } from "../BotProjects";
import { GrantEditor, levelLabel } from "../bot-settings/GrantEditor";
import { ConfirmDialog } from "../ConfirmDialog";
import { useHeldMenuMotion } from "../MenuMotion";
import { PersonAvatar } from "../MessageAuthor";
import { Card } from "../SettingsPrimitives";
import { personLabel } from "@/lib/human-label";

export interface OrgBot {
  id: string;
  name: string;
  ownerPrincipalId: string;
  ownerName: string;
  section?: string;
  engine: { instanceId: string; driver: string };
  grants: WireGrant[];
  /** Its public look (what a room shows of it); absent on an older server. */
  look?: BotPublicProfile;
  /** Working now (a turn, its routine run, a room turn); absent on an older server. */
  running?: boolean;
}

/** Above this many bots the list gets a search field and grouping. */
export const ORG_BOTS_SEARCH_FROM = 8;

/** One line per grant: "Team T (Talk), Bob (Run routines)". */
export function grantsSummary(grants: WireGrant[]): string {
  return grants.map((grant) => `${grant.label} (${levelLabel(grant.level)})`).join(", ");
}

/** The muted half of a row: "Shared with 2 people or teams" or "Not shared". */
export function sharingLine(grants: readonly WireGrant[]): string {
  if (grants.length === 0) return t("organization.sharing.notShared");
  return grants.length === 1 ? t("organization.sharing.sharedWithOne") : t("organization.sharing.sharedWithMany", { count: grants.length });
}

export function ownerLabel(bot: Pick<OrgBot, "ownerName" | "ownerPrincipalId">): string {
  return personLabel(bot.ownerName, bot.ownerPrincipalId);
}

/** The bots whose name, owner or section holds the query (case-insensitive). */
export function filterOrgBots<T extends Pick<OrgBot, "name" | "ownerName" | "ownerPrincipalId" | "section">>(bots: readonly T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...bots];
  return bots.filter((bot) => [bot.name, ownerLabel(bot), bot.section ?? ""].some((value) => value.toLocaleLowerCase().includes(needle)));
}

/** Bots grouped by owner, owners in name order, bots in list order. */
export function groupOrgBotsByOwner<T extends Pick<OrgBot, "ownerName" | "ownerPrincipalId">>(bots: readonly T[]): { ownerId: string; owner: string; bots: T[] }[] {
  const groups = new Map<string, { ownerId: string; owner: string; bots: T[] }>();
  for (const bot of bots) {
    const group = groups.get(bot.ownerPrincipalId) ?? { ownerId: bot.ownerPrincipalId, owner: ownerLabel(bot), bots: [] };
    group.bots.push(bot);
    groups.set(bot.ownerPrincipalId, group);
  }
  return [...groups.values()].sort((a, b) => a.owner.localeCompare(b.owner));
}

/** Ask the server to force-stop a bot (organization admin only). */
export function forceStopOrgBot(botId: string): Promise<unknown> {
  return api(`/api/org/bots/${encodeURIComponent(botId)}/force-stop`, { method: "POST", body: "{}" });
}

/** Ask the server to force-delete a bot; it checks the name matches. */
export function forceDeleteOrgBot(bot: Pick<OrgBot, "id" | "name">): Promise<unknown> {
  return api(`/api/org/bots/${encodeURIComponent(bot.id)}/force-delete`, { method: "POST", body: JSON.stringify({ confirm: bot.name }) });
}

type Toast = { ok: boolean; text: string };

export function OrgSharing({ initial = null, admin = false, initialDirectory = null }: { initial?: OrgBot[] | null; admin?: boolean; initialDirectory?: OrgDirectory | null }) {
  const [bots, setBots] = useState<OrgBot[] | null>(initial);
  const [directory, setDirectory] = useState<OrgDirectory | null>(initialDirectory);
  const [open, setOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<OrgBot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [query, setQuery] = useState("");
  const [byOwner, setByOwner] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const failed = (error: unknown) => setToast({ ok: false, text: error instanceof Error ? error.message : t("organization.sharing.force.failed") });
  const stop = async (bot: OrgBot) => {
    setBusy(bot.id);
    try {
      await forceStopOrgBot(bot.id);
      setBots((current) => current?.map((entry) => (entry.id === bot.id ? { ...entry, running: false } : entry)) ?? current);
      setToast({ ok: true, text: t("organization.sharing.forceStop.done", { name: bot.name }) });
    } catch (error) {
      failed(error);
    } finally {
      setBusy(null);
    }
  };
  const remove = async (bot: OrgBot) => {
    setBusy(bot.id);
    try {
      await forceDeleteOrgBot(bot);
      setBots((current) => current?.filter((entry) => entry.id !== bot.id) ?? current);
      setToast({ ok: true, text: t("organization.sharing.forceDelete.done", { name: bot.name }) });
    } catch (error) {
      failed(error);
    } finally {
      setBusy(null);
      setDeleting(null);
    }
  };

  useEffect(() => {
    let alive = true;
    void api<{ bots: OrgBot[] }>("/api/org/bots").then((body) => { if (alive) setBots(body.bots ?? []); }, () => { if (alive) setBots([]); });
    void api<OrgDirectory>("/api/org/directory").then((body) => { if (alive) setDirectory({ people: body.people ?? [], teams: body.teams ?? [] }); }, () => {});
    return () => { alive = false; };
  }, []);

  const people = useMemo(() => new Map((directory?.people ?? []).map((person) => [person.principalId.toLowerCase(), person])), [directory]);
  const many = (bots?.length ?? 0) > ORG_BOTS_SEARCH_FROM;
  const shown = useMemo(() => (bots ? filterOrgBots(bots, many ? query : "") : []), [bots, many, query]);

  if (bots !== null && bots.length === 0) return null;

  const ownerAvatar = (ownerId: string, owner: string, size = 16) => (
    <PersonAvatar avatarUrl={personAvatarSrc(people.get(ownerId.toLowerCase())?.avatarUrl)} initials={personInitials(owner)} size={size} />
  );
  const row = (bot: OrgBot, showOwner: boolean) => (
    <OrgBotRow
      key={bot.id}
      bot={bot}
      expanded={open === bot.id}
      onToggle={() => setOpen(open === bot.id ? null : bot.id)}
      owner={showOwner ? ownerAvatar(bot.ownerPrincipalId, ownerLabel(bot)) : null}
      admin={admin}
      busy={busy !== null}
      onStop={() => void stop(bot)}
      onDelete={() => setDeleting(bot)}
    >
      <GrantEditor botId={bot.id} ownerId={bot.ownerPrincipalId} initialGrants={bot.grants} initialAdminister={null} directory={directory} />
    </OrgBotRow>
  );

  return (
    <Card cardId="organization.sharing" title={t("organization.sharing.title")}>
      {bots === null ? null : (
        <div className="flex flex-col gap-2" data-org-sharing data-org-sharing-admin={admin ? "true" : "false"}>
          {many && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-w-0 flex-1 basis-48 items-center gap-2 rounded-lg border border-hairline/40 bg-inset px-2.5 py-1.5">
                <Search size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("organization.sharing.search")}
                  aria-label={t("organization.sharing.search")}
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-secondary"
                  data-org-sharing-search
                />
              </label>
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px] text-ink-secondary">
                <input type="checkbox" checked={byOwner} onChange={(event) => setByOwner(event.target.checked)} className="accent-[var(--color-accent)]" />
                {t("organization.sharing.groupByOwner")}
              </label>
            </div>
          )}
          {shown.length === 0 ? (
            <p className="py-2 text-[12.5px] text-ink-secondary">{t("organization.sharing.noMatch")}</p>
          ) : many && byOwner ? (
            groupOrgBotsByOwner(shown).map((group) => (
              <section key={group.ownerId} aria-label={group.owner} data-org-owner-group={group.ownerId}>
                <h4 className="flex items-center gap-1.5 px-1 pb-0.5 pt-1.5 text-[11.5px] font-medium text-ink-secondary">
                  {ownerAvatar(group.ownerId, group.owner, 14)}
                  <span className="truncate">{group.owner}</span>
                  <span className="text-ink-tertiary">{group.bots.length}</span>
                </h4>
                <ul className="flex flex-col">{group.bots.map((bot) => row(bot, false))}</ul>
              </section>
            ))
          ) : (
            <ul className="-mx-1.5 flex flex-col">{shown.map((bot) => row(bot, true))}</ul>
          )}
        </div>
      )}
      {toast && typeof document !== "undefined" && createPortal(
        <div
          role={toast.ok ? "status" : "alert"}
          data-org-sharing-toast
          className={cn(
            "fixed bottom-4 left-1/2 z-[60] max-w-[min(360px,calc(100vw-32px))] -translate-x-1/2 rounded-[9px] border-[0.5px] border-border bg-elevated px-3 py-[9px] text-[12.5px] shadow-lg",
            toast.ok ? "text-ink" : "text-danger",
          )}
        >
          {toast.text}
        </div>,
        document.body,
      )}
      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        title={t("organization.sharing.forceDelete.title", { name: deleting?.name ?? "" })}
        body={t("organization.sharing.forceDelete.body", { name: deleting?.name ?? "", owner: deleting ? ownerLabel(deleting) : "" })}
        confirmLabel={t("organization.sharing.forceDelete")}
        pending={deleting !== null && busy === deleting.id}
        onCancel={() => setDeleting(null)}
        onConfirm={() => { if (deleting) void remove(deleting); }}
      />
    </Card>
  );
}

/** One bot: avatar, name, owner and sharing, status dot, admin menu; the
 * grant editor opens below it. */
export function OrgBotRow({ bot, expanded, onToggle, owner, admin, busy, onStop, onDelete, children }: {
  bot: OrgBot;
  expanded: boolean;
  onToggle: () => void;
  /** The owner's small avatar; null when a group header already names them. */
  owner: React.ReactNode;
  admin: boolean;
  busy: boolean;
  onStop: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const detailsId = `org-bot-${bot.id}-sharing`;
  const look = bot.look ?? { name: bot.name, color: "blue" as const, avatarUrl: null };
  return (
    <li className="flex min-w-0 flex-col" data-org-bot={bot.id}>
      <div className="group/orgbot flex min-w-0 items-center gap-1 rounded-lg px-1.5 hover:bg-hover">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          <BotAvatar bot={look} size={28} animated={false} label="" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] leading-[18px] text-ink">{bot.name}</span>
            <span className="flex min-w-0 items-center gap-1 text-[12px] leading-4 text-ink-secondary">
              {owner && (
                <>
                  {owner}
                  <span className="truncate" title={t("organization.sharing.owner", { name: ownerLabel(bot) })}>{ownerLabel(bot)}</span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span className="shrink-0" data-org-bot-sharing>{sharingLine(bot.grants)}</span>
              {bot.section ? <span className="truncate">· {bot.section}</span> : null}
            </span>
          </span>
          {bot.running !== undefined && (
            <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-ink-secondary" data-org-bot-status={bot.running ? "running" : "idle"} title={bot.running ? t("organization.sharing.running") : t("organization.sharing.idle")}>
              <span aria-hidden="true" className={cn("size-[7px] rounded-full", bot.running ? "bg-accent" : "bg-ink-secondary/40")} />
              <span className="max-sm:sr-only">{bot.running ? t("organization.sharing.running") : t("organization.sharing.idle")}</span>
            </span>
          )}
          <ChevronRight size={14} aria-hidden="true" className={cn("shrink-0 text-ink-secondary transition-transform motion-reduce:transition-none", expanded && "rotate-90")} />
        </button>
        {admin && <OrgBotMenu bot={bot} busy={busy} onStop={onStop} onDelete={onDelete} />}
      </div>
      {expanded && (
        <div id={detailsId} className="mb-1.5 ml-[46px] mr-1.5 mt-0.5 rounded-xl border-[0.5px] border-hairline/50 bg-raised/40 px-3 py-2.5" data-org-bot-details={bot.id}>
          {children}
        </div>
      )}
    </li>
  );
}

/** The "⋯" holding an admin's force actions; delete in red, stop only while
 * the bot works (or when the server does not say). */
function OrgBotMenu({ bot, busy, onStop, onDelete }: { bot: OrgBot; busy: boolean; onStop: () => void; onDelete: () => void }) {
  const [menu, setMenu] = useState<{ left: number; top: number; keyboard: boolean } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = () => { setMenu(null); buttonRef.current?.focus(); };
  useEffect(() => {
    if (!menu) return;
    // Keyboard opening moves focus into the menu; a click leaves it, so no ring shows.
    if (menu.keyboard) menuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) setMenu(null);
    };
    window.addEventListener("mousedown", outside);
    return () => window.removeEventListener("mousedown", outside);
  }, [menu]);
  const motion = useHeldMenuMotion(menu);
  const position = motion.value && {
    left: Math.max(8, Math.min(motion.value.left, window.innerWidth - 228)),
    top: Math.max(8, Math.min(motion.value.top, window.innerHeight - 110)),
  };
  const label = t("organization.sharing.actions", { name: bot.name });
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(menu)}
        disabled={busy}
        data-org-bot-force={bot.id}
        onClick={(event) => {
          if (menu) { close(); return; }
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ left: rect.right - 220, top: rect.bottom + 4, keyboard: event.detail === 0 });
        }}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary outline-none hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-40"
      >
        <MoreHorizontal size={15} aria-hidden="true" />
      </button>
      {motion.shown && position && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          style={position}
          className={cn("fixed z-50 w-[220px] rounded-lg border border-hairline/50 popover-surface bg-card p-1 shadow-xl", motion.className)}
          {...motion.exitProps}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } else navigateThreadMenu(event); }}
        >
          <OrgBotMenuItems bot={bot} busy={busy} onStop={() => { close(); onStop(); }} onDelete={() => { close(); onDelete(); }} />
        </div>,
        document.body,
      )}
    </>
  );
}

/** The admin menu's items: stop only while the bot works (or when the
 * server does not say), delete in red. */
export function OrgBotMenuItems({ bot, busy, onStop, onDelete }: { bot: Pick<OrgBot, "running">; busy: boolean; onStop: () => void; onDelete: () => void }) {
  const canStop = bot.running !== false;
  return (
    <>
      <button type="button" role="menuitem" data-org-force-action="stop" disabled={!canStop || busy} title={canStop ? undefined : t("organization.sharing.idle")} onClick={onStop}
        className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[12px] text-ink outline-none hover:bg-raised focus-visible:bg-raised disabled:opacity-40 disabled:hover:bg-transparent">
        <Square size={12} aria-hidden="true" />{t("organization.sharing.forceStop")}
      </button>
      <button type="button" role="menuitem" data-org-force-action="delete" disabled={busy} onClick={onDelete}
        className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[12px] text-danger outline-none hover:bg-danger/10 focus-visible:bg-danger/10 disabled:opacity-40">
        <Trash2 size={12} aria-hidden="true" />{t("organization.sharing.forceDelete")}
      </button>
    </>
  );
}
