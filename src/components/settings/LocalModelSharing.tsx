// Settings > Local models: who a person's own computer models are shared
// with (D-20261123-023): chosen people and teams of the organization, beside
// the whole-organization switch. The same search, candidates and words as a
// page's share (PageShare.tsx, page-share-plan.ts).
import { useMemo, useState } from "react";
import { X } from "lucide-react";

import { t } from "@/lib/i18n";
import { teamCandidates, withInvite } from "@/lib/page-share-plan";
import { groupPeopleCandidates } from "@/lib/private-threads";
import type { LocalModelRecipients as Recipients } from "@/lib/desktop-local-models";
import type { OrgDirectory } from "@/lib/perspicax-org";
import { cn } from "@/lib/cn";
import { ShareAvatar } from "../PageShare";
import { FIELD } from "../SettingsPrimitives";

export function LocalModelSharing({ directory, viewerId, value, onChange }: {
  directory: OrgDirectory | null;
  viewerId: string | null;
  value: Recipients;
  onChange: (next: Recipients) => void;
}) {
  const [query, setQuery] = useState("");
  const people = useMemo(() => new Map((directory?.people ?? []).map((person) => [person.principalId.toLowerCase(), person])), [directory]);
  const teams = useMemo(() => new Map((directory?.teams ?? []).map((team) => [team.id.toLowerCase(), team])), [directory]);
  const personCandidates = query.trim()
    ? groupPeopleCandidates((directory?.people ?? []).filter((person) => !person.service), { taken: [...value.people, ...(viewerId ? [viewerId] : [])], query, limit: 6 })
    : [];
  const groupCandidates = query.trim() ? teamCandidates(directory?.teams ?? [], value.teams, query, 4) : [];
  const set = (entry: { kind: "person" | "team"; id: string }, add: boolean) => {
    setQuery("");
    onChange(withInvite(value, entry, add));
  };
  const count = value.people.length + value.teams.length;

  return (
    <div className="flex flex-col gap-2" data-local-models-recipients={count}>
      <div className="relative">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200}
          placeholder={t("pages.share.add")} aria-label={t("pages.share.add")} className={cn(FIELD, "w-full text-[13px]")} />
        {query.trim() && (
          <ul role="listbox" aria-label={t("pages.share.add")} className="absolute inset-x-0 top-full z-[1] mt-1 max-h-64 overflow-y-auto rounded-xl border border-hairline/50 bg-elevated p-1 shadow-xl">
            {personCandidates.map((person) => (
              <li key={person.principalId}>
                <button type="button" role="option" aria-selected="false" onClick={() => set({ kind: "person", id: person.principalId }, true)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover">
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
                <button type="button" role="option" aria-selected="false" onClick={() => set({ kind: "team", id: team.id }, true)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover">
                  <ShareAvatar name={team.name} team />
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
      {count > 0 && (
        <ul aria-label={t("localModels.shareWith")} className="flex flex-col gap-1.5">
          {value.people.map((id) => {
            const person = people.get(id.toLowerCase());
            const name = person?.name || person?.login || t("pages.share.someone");
            return (
              <li key={`p:${id}`} data-local-models-recipient={id} className="flex items-center gap-2.5">
                <ShareAvatar name={name} {...(person?.avatarUrl ? { url: person.avatarUrl } : {})} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={person?.email}>{name}</span>
                <button type="button" aria-label={t("pages.share.remove", { name })} title={t("pages.share.remove", { name })} onClick={() => set({ kind: "person", id }, false)}
                  className="rounded-full p-1 text-ink-secondary hover:bg-hover hover:text-ink"><X size={13} aria-hidden="true" /></button>
              </li>
            );
          })}
          {value.teams.map((id) => {
            const team = teams.get(id.toLowerCase());
            const name = team?.name || t("pages.share.someGroup");
            return (
              <li key={`t:${id}`} data-local-models-recipient={id} className="flex items-center gap-2.5">
                <ShareAvatar name={name} team />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{name}</span>
                <button type="button" aria-label={t("pages.share.remove", { name })} title={t("pages.share.remove", { name })} onClick={() => set({ kind: "team", id }, false)}
                  className="rounded-full p-1 text-ink-secondary hover:bg-hover hover:text-ink"><X size={13} aria-hidden="true" /></button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
