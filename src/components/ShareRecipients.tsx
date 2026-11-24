// The people and teams something is shared with, drawn once for every share
// list of the app: a page's Share popover (PageShare.tsx) and Settings > Local
// models (settings/LocalModelSharing.tsx). A search field that offers the
// organization's people and teams, and one row per recipient with its control
// to remove it. The caller owns the list and what a change does; the words
// that name a team come from the caller, so each screen keeps its own.
import { useMemo, useState } from "react";
import { Users, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { initialsOf, teamCandidates } from "@/lib/page-share-plan";
import type { OrgDirectory } from "@/lib/perspicax-org";
import { groupPeopleCandidates } from "@/lib/private-threads";

export interface ShareRecipientList { people: string[]; teams: string[] }
export type ShareRecipient = { kind: "person" | "team"; id: string };

/** The round picture of a person or a team in a share list. */
export function ShareAvatar({ name, url, team }: { name: string; url?: string; team?: boolean }) {
  if (url) return <img src={url} alt="" className="size-7 shrink-0 rounded-full object-cover" />;
  return (
    <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-raised text-[11px] font-semibold text-ink-secondary">
      {team ? <Users size={13} /> : initialsOf(name)}
    </span>
  );
}

/** The search field and the people and teams it offers; a pick empties it. */
export function ShareRecipientSearch({ directory, value, viewerId, disabled = false, label, teamLine, onAdd, className, inputClassName, menuClassName, inputProps }: {
  directory: OrgDirectory | null;
  /** Those already chosen: never offered again. */
  value: ShareRecipientList;
  /** The person sharing: never offered to themselves. */
  viewerId: string | null;
  disabled?: boolean;
  /** The field's placeholder and spoken name. */
  label: string;
  /** The line under a team's name, from its number of people. */
  teamLine: (people: number) => string;
  onAdd: (entry: ShareRecipient) => void;
  className?: string;
  inputClassName: string;
  menuClassName: string;
  inputProps?: Record<`data-${string}`, string>;
}) {
  const [query, setQuery] = useState("");
  const asked = query.trim();
  const personCandidates = asked
    ? groupPeopleCandidates((directory?.people ?? []).filter((person) => !person.service), { taken: [...value.people, ...(viewerId ? [viewerId] : [])], query, limit: 6 })
    : [];
  const groupCandidates = asked ? teamCandidates(directory?.teams ?? [], value.teams, query, 4) : [];
  const add = (entry: ShareRecipient) => {
    setQuery("");
    onAdd(entry);
  };
  const option = "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover disabled:opacity-40";

  return (
    <div className={cn("relative", className)}>
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200}
        placeholder={label} aria-label={label} className={inputClassName} {...inputProps} />
      {asked && (
        <ul role="listbox" aria-label={label} className={cn("absolute inset-x-0 top-full z-[1] mt-1 max-h-64 overflow-y-auto bg-elevated p-1 shadow-xl", menuClassName)}>
          {personCandidates.map((person) => (
            <li key={person.principalId}>
              <button type="button" role="option" aria-selected="false" disabled={disabled} onClick={() => add({ kind: "person", id: person.principalId })} className={option}>
                <ShareAvatar name={person.name || person.login} {...(person.avatarUrl ? { url: person.avatarUrl } : {})} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{person.name || person.login}</span>
                  {person.email && <span className="block truncate text-[11.5px] text-ink-secondary">{person.email}</span>}
                </span>
              </button>
            </li>
          ))}
          {groupCandidates.map((team) => (
            <li key={team.id}>
              <button type="button" role="option" aria-selected="false" disabled={disabled} onClick={() => add({ kind: "team", id: team.id })} className={option}>
                <ShareAvatar name={team.name} team />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{team.name}</span>
                  <span className="block truncate text-[11.5px] text-ink-secondary">{teamLine(new Set([...team.members, ...team.managers]).size)}</span>
                </span>
              </button>
            </li>
          ))}
          {directory && personCandidates.length === 0 && groupCandidates.length === 0 && <li className="px-2 py-1.5 text-[12.5px] text-ink-secondary">{t("pages.share.noMatch")}</li>}
        </ul>
      )}
    </div>
  );
}

/** One `<li>` per chosen person and team, each with its control to remove it.
 * Rendered inside the caller's `<ul>`, which may hold rows of its own. */
export function ShareRecipientRows({ directory, value, disabled = false, unknownTeam, rowAttribute, onRemove }: {
  directory: OrgDirectory | null;
  value: ShareRecipientList;
  disabled?: boolean;
  /** The name of a team the directory no longer lists. */
  unknownTeam: string;
  /** The data attribute that carries a row's id. */
  rowAttribute: `data-${string}`;
  onRemove: (entry: ShareRecipient) => void;
}) {
  const people = useMemo(() => new Map((directory?.people ?? []).map((person) => [person.principalId.toLowerCase(), person])), [directory]);
  const teams = useMemo(() => new Map((directory?.teams ?? []).map((team) => [team.id.toLowerCase(), team])), [directory]);
  const row = (entry: ShareRecipient, name: string, avatar: { url?: string; team?: boolean }, title?: string) => (
    <li key={`${entry.kind === "person" ? "p" : "t"}:${entry.id}`} {...{ [rowAttribute]: entry.id }} className="flex items-center gap-2.5">
      <ShareAvatar name={name} {...avatar} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={title}>{name}</span>
      <button type="button" disabled={disabled} aria-label={t("pages.share.remove", { name })} title={t("pages.share.remove", { name })} onClick={() => onRemove(entry)}
        className="rounded-full p-1 text-ink-secondary hover:bg-hover hover:text-ink disabled:opacity-40"><X size={13} aria-hidden="true" /></button>
    </li>
  );
  return (
    <>
      {value.people.map((id) => {
        const person = people.get(id.toLowerCase());
        return row({ kind: "person", id }, person?.name || person?.login || t("pages.share.someone"), person?.avatarUrl ? { url: person.avatarUrl } : {}, person?.email);
      })}
      {value.teams.map((id) => row({ kind: "team", id }, teams.get(id.toLowerCase())?.name || unknownTeam, { team: true }))}
    </>
  );
}
