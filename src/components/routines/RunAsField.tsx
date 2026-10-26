// "Runs as" in the routine modal (JC, 2026-10-08). On an organization server
// a routine acts with one person's access: their routine delegation and
// their rights on the bot. An admin may pick any active person, a team
// manager the people of their teams (else themselves and the bot's owner);
// anyone else sees only the line. The server decides whom
// (GET /api/routines/run-as-options, server/routine-run-as.ts) and checks
// the choice again on save. A solo server shows nothing.
import { useEffect, useId, useMemo, useState } from "react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { personInitials } from "@/lib/people-dm";
import { personAvatarSrc } from "@/lib/profile-management";
import { PersonAvatar } from "../MessageAuthor";
import { personLabel } from "@/lib/human-label";

export interface RunAsOption {
  principalId: string;
  name: string;
  avatarUrl?: string;
  selectable: boolean;
  reason?: "no_right";
  pending?: true;
}

export interface RunAsOptions {
  canChoose: boolean;
  people: RunAsOption[];
  current?: { principalId: string; name: string; pending?: true };
}

/** Above this many people the dropdown gets a search field. */
export const RUN_AS_SEARCH_AFTER = 8;

/** The dropdown's rows: the people matching `query`, the selected one always
 * kept (first, when the server did not list it). */
export function runAsRows(options: RunAsOptions, selected: string | undefined, query: string): RunAsOption[] {
  const needle = query.trim().toLocaleLowerCase();
  const rows = options.people.filter((person) => !needle || person.principalId === selected || person.name.toLocaleLowerCase().includes(needle));
  const listed = options.people.some((person) => person.principalId === selected);
  if (!listed && selected && options.current?.principalId === selected) {
    return [{ principalId: selected, name: options.current.name || selected, selectable: true, ...(options.current.pending ? { pending: true as const } : {}) }, ...rows];
  }
  return rows;
}

/** The option's text: its name, and why it cannot be chosen. */
export function runAsOptionLabel(person: RunAsOption): string {
  const name = personLabel(person.name, person.principalId);
  return person.selectable ? name : t("routines.runAsField.noRight", { name });
}

export function RunAsField({ options, value, onChange }: {
  options: RunAsOptions | null;
  /** The chosen principal id (undefined: the routine's current person). */
  value: string | undefined;
  onChange: (principalId: string) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const selected = value ?? options?.current?.principalId;
  const rows = useMemo(() => (options ? runAsRows(options, selected, query) : []), [options, selected, query]);
  if (!options?.current && !options?.canChoose) return null;
  const chosen = rows.find((person) => person.principalId === selected)
    ?? options.people.find((person) => person.principalId === selected)
    ?? (options.current ? { principalId: options.current.principalId, name: options.current.name, selectable: true, ...(options.current.pending ? { pending: true as const } : {}) } : undefined);
  const chosenName = chosen ? personLabel(chosen.name, chosen.principalId) : "";
  const avatar = <PersonAvatar avatarUrl={personAvatarSrc(chosen?.avatarUrl)} initials={personInitials(chosenName || "?")} size={24} />;
  const pendingHint = chosen?.pending ? <p data-run-as-pending className="text-[11px] leading-relaxed text-ink-secondary">{t("routines.runAsField.pending", { name: chosenName })}</p> : null;
  if (!options.canChoose) {
    return <div data-run-as-field className="min-w-0 space-y-1.5">
      <div className="flex min-w-0 items-center gap-2 text-[12px] text-ink">{avatar}<span className="truncate">{t("routines.runAs", { name: chosenName })}</span></div>
    </div>;
  }
  return <div data-run-as-field className="min-w-0 space-y-1.5">
    <label htmlFor={id} className="block text-[12px] font-medium text-ink">{t("routines.runAsField.label")}</label>
    {options.people.length > RUN_AS_SEARCH_AFTER && (
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("routines.runAsField.search")}
        aria-label={t("routines.runAsField.search")}
        maxLength={200}
        className="w-full min-w-0 rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink-secondary focus:border-accent"
      />
    )}
    <div className="flex min-w-0 items-center gap-2">
      {avatar}
      <select id={id} aria-describedby={`${id}-help`} value={selected ?? ""}
        onChange={(event) => { if (event.target.value) onChange(event.target.value); }}
        className="w-full min-w-0 rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[12.5px] text-ink outline-none focus:border-accent disabled:opacity-50">
        {rows.length === 0 && <option value="" disabled>{t("routines.runAsField.none")}</option>}
        {rows.map((person) => <option key={person.principalId} value={person.principalId} disabled={!person.selectable}>{runAsOptionLabel(person)}</option>)}
      </select>
    </div>
    {pendingHint}
    <p id={`${id}-help`} className="text-[11px] leading-relaxed text-ink-secondary">{t("routines.runAsField.help")}</p>
  </div>;
}

/** The run-as options for a routine of this bot, asked again when the bot,
 * the room or the routine changes. Null until the server answers, or when
 * it cannot (a solo server answers with no choice and no current person). */
export function useRunAsOptions(input: { botId: string | undefined; routineId?: string; target: string; groupId?: string }): RunAsOptions | null {
  const [options, setOptions] = useState<RunAsOptions | null>(null);
  const { botId, routineId, target, groupId } = input;
  useEffect(() => {
    if (!botId) { setOptions(null); return; }
    let alive = true;
    const query = new URLSearchParams({ botId, target, ...(routineId ? { routineId } : {}), ...(groupId ? { groupId } : {}) });
    void api<RunAsOptions>(`/api/routines/run-as-options?${query.toString()}`).then(
      (body) => { if (alive) setOptions({ canChoose: Boolean(body.canChoose), people: body.people ?? [], ...(body.current ? { current: body.current } : {}) }); },
      () => { if (alive) setOptions(null); },
    );
    return () => { alive = false; };
  }, [botId, routineId, target, groupId]);
  return options;
}
