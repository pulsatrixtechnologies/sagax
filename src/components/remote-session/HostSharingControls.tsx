// Which bots may use an enrolled host, and who it is shared with (#2957).
// Two small windows opened from a host row's "⋯" menu, and the bot picker
// alone inside the Add computer wizard (step 2). The default is "All bots":
// a host with no stored scope lets every bot of the person use it; naming
// bots limits it to them, and the server refuses the others. Sharing gives
// a person or a group of the organization the same computer in their own
// list (marked "Shared by <me>"); their bots use it with the host's access.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bot as BotIcon, Loader2, Users, X } from "lucide-react";

import { DialogFrame, DialogLayer, PILL, PRIMARY_PILL } from "@/components/SettingsPrimitives";
import { useOrgDirectory } from "@/components/GroupPeoplePicker";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { initialsOf, teamCandidates } from "@/lib/page-share-plan";
import { type OrgDirectoryPerson } from "@/lib/perspicax-org";
import { groupPeopleCandidates } from "@/lib/private-threads";
import { readableError } from "@/lib/plain-error";
import { useStoreOptional } from "@/state/store";
import { EMPTY_PERSONAL_SECTIONS, personalSectionNames, usePersonalSections } from "@/lib/personal-sections";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import {
  fetchRemoteHosts,
  placeRemoteHost,
  setRemoteHostBots,
  shareRemoteHost,
  unshareRemoteHost,
  type HostShareTarget,
  type UnattendedHostShare,
} from "./remote-hosts-client";

export interface HostBotChoice { id: string; name: string }

/** The person's bots a host can be limited to: hidden and temporary ones left out. */
export function useHostBotChoices(): HostBotChoice[] {
  const store = useStoreOptional();
  const bots = store?.state.bots;
  return useMemo(
    () => (bots ?? []).filter((bot) => !bot.hidden).map((bot) => ({ id: bot.id, name: bot.name?.trim() || t("remoteSessionsAdmin.hosts.bots.unnamed") })),
    [bots],
  );
}

/** "All bots", or the allowed bots by name ("Ember, Katarina"). A bot that
 * no longer exists counts by number so nothing on the row is invented. */
export function hostBotsLabel(scope: readonly string[] | null | undefined, bots: readonly HostBotChoice[]): string {
  if (!scope || scope.length === 0) return t("remoteSessionsAdmin.hosts.bots.all");
  const names = scope.map((id) => bots.find((bot) => bot.id === id)?.name).filter((name): name is string => Boolean(name));
  const missing = scope.length - names.length;
  if (missing > 0) names.push(t("remoteSessionsAdmin.hosts.bots.others", { count: String(missing) }));
  return names.join(", ");
}

/** The picker itself: "All bots" first, then one checkbox per bot. Choosing
 * a bot leaves "All bots"; clearing every bot comes back to it. */
export function HostBotsPicker({ bots, value, onChange, disabled, name }: {
  bots: readonly HostBotChoice[];
  /** null = all bots. */
  value: readonly string[] | null;
  onChange: (next: string[] | null) => void;
  disabled?: boolean;
  /** For the group's accessible name. */
  name?: string;
}) {
  const all = !value || value.length === 0;
  const toggle = (id: string) => {
    const current = value ?? [];
    const next = current.includes(id) ? current.filter((each) => each !== id) : [...current, id];
    onChange(next.length ? next : null);
  };
  return (
    <div role="group" aria-label={name ?? t("remoteSessionsAdmin.hosts.bots.title")} data-host-bots-picker=""
      className="flex flex-col divide-y divide-hairline/40 overflow-clip rounded-xl border-[0.5px] border-border bg-elevated">
      <label className={cn("flex min-h-[44px] cursor-pointer items-center gap-3 px-3.5 py-2.5 md:min-h-0", disabled && "cursor-not-allowed opacity-50")}>
        <input type="checkbox" data-host-bots-all="" checked={all} disabled={disabled} aria-expanded={!all}
          onChange={() => onChange(all ? bots.map((bot) => bot.id) : null)} className="size-4 accent-[var(--accent)]" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[13px] leading-[18px] text-ink">{t("remoteSessionsAdmin.hosts.bots.all")}</span>
          <span className="text-[12px] leading-4 text-ink-secondary">{t("remoteSessionsAdmin.hosts.bots.allHint")}</span>
        </span>
      </label>
      {/* #3134: "All bots" hides the list instead of showing every bot unchecked;
          unchecking it opens the list with every bot picked, to trim. */}
      {!all && bots.map((bot) => (
        <label key={bot.id} className={cn("flex min-h-[44px] cursor-pointer items-center gap-3 px-3.5 py-2.5 md:min-h-0", disabled && "cursor-not-allowed opacity-50")}>
          <input type="checkbox" data-host-bot={bot.id} checked={(value ?? []).includes(bot.id)} disabled={disabled} onChange={() => toggle(bot.id)} className="size-4 accent-[var(--accent)]" />
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-raised text-ink-secondary"><BotIcon size={13} aria-hidden="true" /></span>
          <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-ink">{bot.name}</span>
        </label>
      ))}
      {bots.length === 0 && <p className="px-3.5 py-2.5 text-[12px] text-ink-secondary">{t("remoteSessionsAdmin.hosts.bots.none")}</p>}
    </div>
  );
}

function SmallDialog({ titleId, title, subtitle, hooks, busy, onClose, footer, children }: {
  titleId: string; title: string; subtitle?: string; hooks: Record<string, string>; busy: boolean; onClose: () => void; footer: ReactNode; children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  useModalDialog(frameRef, onClose);
  return (
    <DialogLayer onBackdropMouseDown={() => { if (!busy) onClose(); }}>
      <DialogFrame titleId={titleId} title={title} subtitle={subtitle} width="sm" closeLabel={t("common.close")} onClose={onClose}
        closeDisabled={busy} frameRef={frameRef} frameProps={{ ...hooks, "aria-busy": busy || undefined }} footer={footer} footerDivider>
        {children}
      </DialogFrame>
    </DialogLayer>
  );
}

/** "Bots…" from a host row: which of the person's bots may use it. */
export function HostBotsDialog({ hostId, host, value, onSaved, onClose }: {
  hostId: string;
  /** The readable host name. */
  host: string;
  value: readonly string[] | null | undefined;
  onSaved: (next: string[] | null) => void;
  onClose: () => void;
}) {
  const bots = useHostBotChoices();
  const [draft, setDraft] = useState<string[] | null>(value && value.length ? [...value] : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const out = await setRemoteHostBots(hostId, draft);
      onSaved(out.bots);
      onClose();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SmallDialog titleId="host-bots-title" title={t("remoteSessionsAdmin.hosts.bots.title")} subtitle={t("remoteSessionsAdmin.hosts.bots.subtitle", { host })}
      hooks={{ "data-host-bots-dialog": hostId }} busy={busy} onClose={onClose}
      footer={<>
        <button type="button" className={PILL} disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" data-host-bots-save="" className={PRIMARY_PILL} disabled={busy} onClick={() => void save()}>
          {busy && <Loader2 size={13} aria-hidden="true" className="animate-spin" />}{t("common.save")}
        </button>
      </>}>
      <div className="flex flex-col gap-3">
        {error && <p role="alert" className="rounded-lg bg-danger/10 p-2 text-[12px] text-danger">{error}</p>}
        <HostBotsPicker bots={bots} value={draft} onChange={setDraft} disabled={busy} />
      </div>
    </SmallDialog>
  );
}

/** The teams a host can be placed on: the person's own sections in an
 * organization, else the server's sections and the groups' sections. */
function useTeamNames(): string[] {
  const store = useStoreOptional();
  const personal = usePersonalSections();
  const org = usePerspicaxOrg() !== null;
  const sections = store?.state.sections;
  const groups = store?.state.groups;
  return useMemo(() => org
    ? personalSectionNames(personal ?? EMPTY_PERSONAL_SECTIONS)
    : [...new Set([...(sections ?? []), ...(groups ?? []).flatMap((group) => group.section && group.ownerId === undefined ? [group.section] : [])])].filter(Boolean),
  [org, personal, sections, groups]);
}

/** "Team…" from a host row: the team this computer is the default for (it
 * moved here from the Team map's Computers panel). */
export function HostTeamDialog({ hostId, host, onClose }: { hostId: string; host: string; onClose: () => void }) {
  const teams = useTeamNames();
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void fetchRemoteHosts()
      .then((answer) => { if (!alive) return; const section = answer.hosts.find((row) => row.hostId === hostId)?.section ?? null; setCurrent(section); setDraft(section); })
      .catch(() => { if (alive) setCurrent(null); });
    return () => { alive = false; };
  }, [hostId]);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await placeRemoteHost(hostId, draft);
      onClose();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };
  const options = current && !teams.includes(current) ? [current, ...teams] : teams;
  return (
    <SmallDialog titleId="host-team-title" title={t("remoteSessionsAdmin.hosts.team.title")} subtitle={t("remoteSessionsAdmin.hosts.team.subtitle", { host })}
      hooks={{ "data-host-team-dialog": hostId }} busy={busy} onClose={onClose}
      footer={<>
        <button type="button" className={PILL} disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" data-host-team-save="" className={PRIMARY_PILL} disabled={busy || current === undefined || draft === current} onClick={() => void save()}>
          {busy && <Loader2 size={13} aria-hidden="true" className="animate-spin" />}{t("common.save")}
        </button>
      </>}>
      <div className="flex flex-col gap-3">
        {error && <p role="alert" className="rounded-lg bg-danger/10 p-2 text-[12px] text-danger">{error}</p>}
        <label className="flex flex-col gap-1.5 text-[12px] text-ink-secondary">
          {t("remoteSessionsAdmin.hosts.team.label")}
          <select data-host-team-select="" value={draft ?? ""} disabled={busy || current === undefined} onChange={(event) => setDraft(event.target.value || null)}
            className="w-full rounded-lg border border-hairline/60 bg-inset px-3 py-2 text-[13px] text-ink outline-none focus:border-accent">
            <option value="">{t("remoteSessionsAdmin.hosts.team.none")}</option>
            {options.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <p className="text-[12px] leading-4 text-ink-secondary">{t("remoteSessionsAdmin.hosts.team.hint")}</p>
      </div>
    </SmallDialog>
  );
}

function Avatar({ name, url, team }: { name: string; url?: string; team?: boolean }) {
  if (url) return <img src={url} alt="" className="size-7 shrink-0 rounded-full object-cover" />;
  return (
    <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-raised text-[11px] font-semibold text-ink-secondary">
      {team ? <Users size={13} /> : initialsOf(name)}
    </span>
  );
}

/** "Share…" from a host row: the organization's people and groups, as the
 * pages' Share window picks them (PageShare.tsx), and the current shares
 * with their remove button. Every change saves at once. */
export function HostShareDialog({ hostId, host, shares, onChanged, onClose }: {
  hostId: string;
  host: string;
  shares: readonly UnattendedHostShare[];
  onChanged: (shares: UnattendedHostShare[]) => void;
  onClose: () => void;
}) {
  const directory = useOrgDirectory(true);
  const store = useStoreOptional();
  const viewerId = store?.state.config?.viewer?.principalId ?? null;
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const people = useMemo(() => new Map((directory?.people ?? []).map((person) => [person.principalId.toLowerCase(), person])), [directory]);
  const takenPeople = shares.filter((share) => share.kind === "person").map((share) => share.id);
  const takenTeams = shares.filter((share) => share.kind === "team").map((share) => share.id);
  const personCandidates = query.trim()
    ? groupPeopleCandidates((directory?.people ?? []).filter((person) => !person.service), { taken: [...takenPeople, ...(viewerId ? [viewerId] : [])], query, limit: 6 })
    : [];
  const groupCandidates = query.trim() ? teamCandidates(directory?.teams ?? [], takenTeams, query, 4) : [];
  const run = async (target: HostShareTarget, add: boolean) => {
    setQuery("");
    setBusy(true);
    setError("");
    try {
      const out = add ? await shareRemoteHost(hostId, target) : await unshareRemoteHost(hostId, target);
      onChanged(out.shares);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };
  const hookId = (share: UnattendedHostShare) => `${share.kind}:${share.id}`;
  return (
    <SmallDialog titleId="host-share-title" title={t("remoteSessionsAdmin.hosts.share.title", { host })} subtitle={t("remoteSessionsAdmin.hosts.share.subtitle")}
      hooks={{ "data-host-share-dialog": hostId }} busy={busy} onClose={onClose}
      footer={<button type="button" data-host-share-done="" className={PRIMARY_PILL} onClick={onClose}>{t("canvasComputers.unattended.done")}</button>}>
      <div className="flex flex-col gap-3">
        {error && <p role="alert" className="rounded-lg bg-danger/10 p-2 text-[12px] text-danger">{error}</p>}
        <div className="relative">
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200} autoFocus disabled={busy}
            placeholder={t("remoteSessionsAdmin.hosts.share.add")} aria-label={t("remoteSessionsAdmin.hosts.share.add")} data-host-share-search=""
            className="min-h-[44px] w-full rounded-xl border-[0.5px] border-border bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-tertiary focus:border-focus focus:outline-none md:min-h-0" />
          {query.trim() && (
            <ul role="listbox" aria-label={t("remoteSessionsAdmin.hosts.share.add")} className="absolute inset-x-0 top-full z-[1] mt-1 max-h-64 overflow-y-auto rounded-xl border border-hairline/50 bg-elevated p-1 shadow-xl">
              {personCandidates.map((person: OrgDirectoryPerson) => (
                <li key={person.principalId}>
                  <button type="button" role="option" aria-selected="false" disabled={busy} data-host-share-add={`person:${person.principalId}`}
                    onClick={() => void run({ kind: "person", id: person.principalId }, true)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover disabled:opacity-40">
                    <Avatar name={person.name || person.login} {...(person.avatarUrl ? { url: person.avatarUrl } : {})} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{person.name || person.login}</span>
                      {person.email && <span className="block truncate text-[11.5px] text-ink-secondary">{person.email}</span>}
                    </span>
                  </button>
                </li>
              ))}
              {groupCandidates.map((team) => (
                <li key={team.id}>
                  <button type="button" role="option" aria-selected="false" disabled={busy} data-host-share-add={`team:${team.id}`}
                    onClick={() => void run({ kind: "team", id: team.id }, true)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover disabled:opacity-40">
                    <Avatar name={team.name} team />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{team.name}</span>
                      <span className="block truncate text-[11.5px] text-ink-secondary">{t("pages.share.group", { count: String(new Set([...team.members, ...team.managers]).size) })}</span>
                    </span>
                  </button>
                </li>
              ))}
              {directory && personCandidates.length === 0 && groupCandidates.length === 0 && <li className="px-2 py-1.5 text-[12.5px] text-ink-secondary">{t("pages.share.noMatch")}</li>}
            </ul>
          )}
        </div>
        {shares.length > 0 ? (
          <ul aria-label={t("remoteSessionsAdmin.hosts.share.current")} data-host-share-list="" className="flex flex-col gap-1.5">
            {shares.map((share) => {
              const person = share.kind === "person" ? people.get(share.id.toLowerCase()) : undefined;
              const name = share.name || person?.name || person?.login || share.id;
              return (
                <li key={hookId(share)} data-host-share={hookId(share)} className="flex items-center gap-2.5">
                  <Avatar name={name} team={share.kind === "team"} {...(person?.avatarUrl ? { url: person.avatarUrl } : {})} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{name}</span>
                  <span className="text-[12px] text-ink-secondary">{share.kind === "team" ? t("remoteSessionsAdmin.hosts.share.groupKind") : t("remoteSessionsAdmin.hosts.share.personKind")}</span>
                  <button type="button" disabled={busy} data-host-share-remove={hookId(share)} aria-label={t("pages.share.remove", { name })} title={t("pages.share.remove", { name })}
                    onClick={() => void run({ kind: share.kind, id: share.id }, false)}
                    className="rounded-full p-1 text-ink-secondary hover:bg-hover hover:text-ink disabled:opacity-40"><X size={13} /></button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p data-host-share-empty="" className="text-[12px] leading-relaxed text-ink-secondary">{t("remoteSessionsAdmin.hosts.share.empty")}</p>
        )}
      </div>
    </SmallDialog>
  );
}
