// Settings > Organization, admins only (slice 8): "People from before
// Perspicax". Each interim person (known by an address on this server) is
// attached by an admin to the Perspicax person who is them; a matching
// address is only a suggestion, never an automatic attach.
import { useEffect, useState } from "react";

import { activeLocale, t } from "@/lib/i18n";
import type { OrgDirectoryPerson } from "@/lib/perspicax-org";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { CountPill, DANGER_PILL, DescribedRow, PILL, PillSelect } from "../SettingsPrimitives";
import { personLabel } from "@/lib/human-label";

export interface InterimPerson {
  principalId: string;
  email: string;
  bots: number;
  rooms: number;
  routines: number;
  suggested: { principalId: string; name: string; login: string } | null;
}

/** The people an interim person may be attached to: active, by name. */
export function attachCandidates(people: readonly OrgDirectoryPerson[]): OrgDirectoryPerson[] {
  return people.filter((person) => !person.disabled).sort((a, b) => a.name.localeCompare(b.name) || a.login.localeCompare(b.login));
}

export function InterimPeople({ until, onChanged }: { until: number; onChanged: () => void | Promise<void> }) {
  const [people, setPeople] = useState<InterimPerson[] | null>(null);
  const [directory, setDirectory] = useState<OrgDirectoryPerson[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const load = async () => {
    try {
      const [interim, dir] = await Promise.all([
        api<{ people: InterimPerson[] }>("/api/org/interim-people"),
        api<{ people?: OrgDirectoryPerson[] }>("/api/org/directory"),
      ]);
      setPeople(interim.people ?? []);
      setDirectory(attachCandidates(dir.people ?? []));
    } catch {
      setPeople([]);
    }
  };
  useEffect(() => { void load(); }, []);

  const targetOf = (person: InterimPerson) => picked[person.principalId] ?? person.suggested?.principalId ?? "";
  const nameOf = (principalId: string) => personLabel(directory.find((entry) => entry.principalId === principalId)?.name, principalId);
  const attach = async (person: InterimPerson) => {
    const to = targetOf(person);
    setBusy(true);
    setError("");
    try {
      await api("/api/org/interim-people/attach", { method: "POST", body: JSON.stringify({ interimPrincipalId: person.principalId, principalId: to }) });
      setNotice(t("interim.attached", { name: nameOf(to) }));
      setConfirming(null);
      await load();
      await onChanged();
    } catch {
      setError(t("interim.failed"));
    } finally {
      setBusy(false);
    }
  };
  const closeNow = async () => {
    setBusy(true);
    try {
      await api("/api/org/settings", { method: "PATCH", body: JSON.stringify({ interimAttachDays: 0 }) });
      await onChanged();
    } catch {
      setError(t("interim.failed"));
    } finally {
      setBusy(false);
    }
  };

  const date = new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium" }).format(new Date(until));
  const list = people ?? [];
  // 0.5.6 (JC): one Grok-style row (its window in grey, the count pill
  // that unfolds the people); attaching asks first, in a red pill.
  return (
    <div data-settings-card="organization.interimPeople" data-interim-people>
      <DescribedRow
        label={t("interim.title")}
        rowId="interimPeople"
        description={t("interim.until", { date })}
        below={open && (
          <div className="mt-2 flex flex-col gap-2 text-[13px]">
            <p className="text-[12px] leading-4 text-ink-secondary">{t("interim.intro")}</p>
            <ul className="flex flex-col gap-1" aria-label={t("interim.title")}>
              {list.map((person) => {
                const target = targetOf(person);
                return (
                  <li key={person.principalId} className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-inset px-3 py-2">
                    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <span className="min-w-0 break-all text-ink">{person.email}</span>
                      <span className="text-[12px] text-ink-secondary">{t("interim.counts", { bots: person.bots, rooms: person.rooms, routines: person.routines })}</span>
                    </div>
                    {confirming === person.principalId ? (
                      <div role="group" aria-label={t("interim.attach")} className="flex flex-wrap items-center justify-end gap-2">
                        <p className="mr-auto min-w-0 text-[12px] text-ink">{t("interim.confirm", { from: person.email, to: nameOf(target) })}</p>
                        <button type="button" className={PILL} autoFocus disabled={busy} onClick={() => setConfirming(null)}>{t("interim.cancel")}</button>
                        <button type="button" className={cn(DANGER_PILL, "min-h-[44px] md:min-h-0")} disabled={busy} onClick={() => void attach(person)}>{t("interim.attach")}</button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="mr-auto text-[12px] text-ink-secondary">{t("interim.pick")}</span>
                        <PillSelect
                          value={target}
                          ariaLabel={t("interim.pick")}
                          disabled={busy}
                          onChange={(next) => setPicked((current) => ({ ...current, [person.principalId]: next }))}
                          options={[{ value: "", label: t("interim.choose") }, ...directory.map((entry) => ({ value: entry.principalId, label: entry.name }))]}
                        />
                        <button type="button" className={PILL} disabled={busy || !target} onClick={() => setConfirming(person.principalId)}>{t("interim.attach")}</button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {notice && <p role="status" className="text-[12px] text-ink">{notice}</p>}
            {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
            <button type="button" className={cn(PILL, "self-start")} disabled={busy} onClick={() => void closeNow()}>{t("interim.closeNow")}</button>
          </div>
        )}
      >
        <CountPill count={list.length} open={open} label={t("interim.title")} onToggle={() => setOpen((value) => !value)} />
      </DescribedRow>
    </div>
  );
}
