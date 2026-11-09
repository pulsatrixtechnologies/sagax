// Share from the reader's bar (2026-10-28): the same popover as in the app
// (src/components/PageShare.tsx), on the same routes and the same plan
// (src/lib/page-share-plan.ts), for the page's own person only:
//   « Share "<title>" », Add people or groups (the organization's directory),
//   who has access (Owner, then those invited), General access (People you
//   invite, Anyone in your organization, Anyone with the link while the
//   organization's policy allows public links, with a second press), and
//   Copy link. The server checks every rule again.
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Globe, Link2, Loader2, Lock, Users, X } from "lucide-react";

import { copyText } from "@/lib/copy-text";
import { initialsOf, needsLinkConfirm, pageReadingUrl, sharePlan, teamCandidates, withInvite, type ShareChange } from "@/lib/page-share-plan";
import { groupPeopleCandidates } from "@/lib/private-threads";
import type { OrgDirectory, OrgDirectoryPerson } from "@/lib/perspicax-org";
import { readerText, type ReaderBoot, type ReaderStringKey } from "../../shared/page-reader";
import type { PageAccess, PagesPolicy, PublishedPageSummary } from "../../shared/published-pages";
import { readerApi, ReaderApiError } from "./api";

const ACCESS_ROWS: Array<{ access: PageAccess; icon: typeof Lock; label: ReaderStringKey; hint: ReaderStringKey }> = [
  { access: "private", icon: Lock, label: "invited", hint: "invitedHint" },
  { access: "org", icon: Users, label: "org", hint: "orgHint" },
  { access: "link", icon: Globe, label: "link", hint: "linkHint" },
];

function Avatar({ name, url, team }: { name: string; url?: string; team?: boolean }) {
  if (url) return <img src={url} alt="" className="sr-avatar" />;
  return <span aria-hidden="true" className="sr-avatar">{team ? <Users size={13} /> : initialsOf(name)}</span>;
}

export function ReaderShare({ boot, pageId, onClose }: { boot: ReaderBoot; pageId: string; onClose(): void }) {
  const text = (key: ReaderStringKey, values?: Record<string, string>) => readerText(boot.lang, key, values);
  const [page, setPage] = useState<PublishedPageSummary | null>(null);
  const [policy, setPolicy] = useState<PagesPolicy | null>(null);
  const [organization, setOrganization] = useState(false);
  const [directory, setDirectory] = useState<OrgDirectory | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingLink, setPendingLink] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    const id = encodeURIComponent(pageId);
    void readerApi<{ page: PublishedPageSummary }>(`/api/pages/${id}`).then((answer) => { if (live) setPage(answer.page); }, () => { if (live) setError(readerText(boot.lang, "failed")); });
    void readerApi<PagesPolicy>("/api/pages/policy").then((answer) => { if (live) setPolicy(answer); }, () => undefined);
    void readerApi<{ org?: { identity?: { kind?: string } } | null }>("/api/org", { headers: { "x-sagax-org-probe": "1" } }).then((answer) => {
      if (!live || answer?.org?.identity?.kind !== "perspicax") return;
      setOrganization(true);
      void readerApi<OrgDirectory>("/api/org/directory").then(
        (body) => { if (live) setDirectory({ people: body.people ?? [], teams: body.teams ?? [] }); },
        () => { if (live) setDirectory({ people: [], teams: [] }); },
      );
    }, () => undefined);
    return () => { live = false; };
  }, [pageId]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && !ref.current?.contains(target) && !target.closest("[data-reader-share]")) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const people = useMemo(() => new Map((directory?.people ?? []).map((person) => [person.principalId.toLowerCase(), person])), [directory]);
  const teams = useMemo(() => new Map((directory?.teams ?? []).map((team) => [team.id.toLowerCase(), team])), [directory]);

  const run = async (change: ShareChange): Promise<PublishedPageSummary | null> => {
    if (!page) return null;
    const steps = sharePlan(page, boot.version, change);
    if (!steps.length) return page;
    setBusy(true);
    setError("");
    let next: PublishedPageSummary | null = null;
    try {
      for (const step of steps) {
        const answer = await readerApi<{ page: PublishedPageSummary }>(`/api/pages/${encodeURIComponent(page.id)}${step.path}`, { method: step.method, body: step.body });
        next = answer.page;
      }
      if (next) setPage(next);
      return next;
    } catch (cause) {
      setError(cause instanceof ReaderApiError && cause.code === "link_sharing_off" ? text("linkOffError") : text("failed"));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const invites = page?.invites ?? { people: [], teams: [] };
  const meId = boot.me?.id ?? null;
  const personCandidates = organization && query.trim()
    ? groupPeopleCandidates((directory?.people ?? []).filter((person) => !person.service), { taken: [...invites.people, ...(meId ? [meId] : [])], query, limit: 6 })
    : [];
  const groupCandidates = organization && query.trim() ? teamCandidates(directory?.teams ?? [], invites.teams, query, 4) : [];
  const access = page?.access ?? "private";
  const linkOff = policy?.linkSharing === false;

  const invite = (entry: { kind: "person" | "team"; id: string }, add: boolean) => {
    setQuery("");
    void run({ kind: "invites", invites: withInvite(invites, entry, add) });
  };
  const choose = (next: PageAccess) => {
    if (next === access) return;
    if (needsLinkConfirm(access, next) && !pendingLink) return setPendingLink(true);
    setPendingLink(false);
    void run({ kind: "access", access: next });
  };
  const copy = async () => {
    const link = pageReadingUrl(page?.url) ?? pageReadingUrl(`${location.origin}${location.pathname}`);
    if (!link) return;
    // copyText: the bridge fallback and a reported failure, never a silent
    // direct clipboard write (src/lib/copy-text.guard.test.ts)
    if (await copyText(link) === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } else {
      setError(text("failed"));
    }
  };
  const ownerName = (meId && people.get(meId.toLowerCase())?.name) || boot.owner?.name || text("you");
  const ownerAvatar = meId ? people.get(meId.toLowerCase())?.avatarUrl : undefined;

  return (
    <div ref={ref} role="dialog" aria-label={text("shareTitle", { title: boot.title })} data-page-share-popover={pageId} className="sr-popover">
      <div className="sr-popover-head">
        <h2>{text("shareTitle", { title: page?.title || boot.title })}</h2>
        {(busy || !page) && <Loader2 size={14} className="sr-spin" aria-hidden="true" />}
        <button type="button" className="sr-icon-button" aria-label={text("close")} title={text("close")} onClick={onClose}><X size={14} /></button>
      </div>

      {organization && (
        <div className="sr-search">
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200}
            placeholder={text("add")} aria-label={text("add")} data-page-share-search disabled={!page} />
          {query.trim() && (
            <ul role="listbox" aria-label={text("add")} className="sr-menu">
              {personCandidates.map((person: OrgDirectoryPerson) => (
                <li key={person.principalId}>
                  <button type="button" role="option" aria-selected="false" disabled={busy} onClick={() => invite({ kind: "person", id: person.principalId }, true)} className="sr-row sr-row-button">
                    <Avatar name={person.name || person.login} {...(person.avatarUrl ? { url: person.avatarUrl } : {})} />
                    <span className="sr-row-text">
                      <span>{person.name || person.login}</span>
                      {person.email && <small>{person.email}</small>}
                    </span>
                  </button>
                </li>
              ))}
              {groupCandidates.map((team) => (
                <li key={team.id}>
                  <button type="button" role="option" aria-selected="false" disabled={busy} onClick={() => invite({ kind: "team", id: team.id }, true)} className="sr-row sr-row-button">
                    <Avatar name={team.name} team />
                    <span className="sr-row-text">
                      <span>{team.name}</span>
                      <small>{text("group", { count: String(new Set([...team.members, ...team.managers]).size) })}</small>
                    </span>
                  </button>
                </li>
              ))}
              {directory && personCandidates.length === 0 && groupCandidates.length === 0 && <li className="sr-muted sr-pad">{text("noMatch")}</li>}
            </ul>
          )}
        </div>
      )}

      <p className="sr-label">{text("people")}</p>
      <ul aria-label={text("people")} className="sr-people">
        <li className="sr-row">
          <Avatar name={ownerName} {...(ownerAvatar ? { url: ownerAvatar } : {})} />
          <span className="sr-row-text"><span>{ownerName}</span></span>
          <span className="sr-muted">{text("owner")}</span>
        </li>
        {invites.people.map((id) => {
          const person = people.get(id.toLowerCase());
          const name = person?.name || person?.login || text("someone");
          return (
            <li key={`p:${id}`} data-page-invite={id} className="sr-row">
              <Avatar name={name} {...(person?.avatarUrl ? { url: person.avatarUrl } : {})} />
              <span className="sr-row-text" title={person?.email}><span>{name}</span></span>
              <button type="button" disabled={busy} className="sr-icon-button" aria-label={text("remove", { name })} title={text("remove", { name })} onClick={() => invite({ kind: "person", id }, false)}><X size={13} /></button>
            </li>
          );
        })}
        {invites.teams.map((id) => {
          const team = teams.get(id.toLowerCase());
          const name = team?.name || text("someGroup");
          return (
            <li key={`t:${id}`} data-page-invite={id} className="sr-row">
              <Avatar name={name} team />
              <span className="sr-row-text"><span>{name}</span></span>
              <button type="button" disabled={busy} className="sr-icon-button" aria-label={text("remove", { name })} title={text("remove", { name })} onClick={() => invite({ kind: "team", id }, false)}><X size={13} /></button>
            </li>
          );
        })}
      </ul>

      <fieldset className="sr-access" disabled={busy || !page}>
        <legend className="sr-label">{text("general")}</legend>
        {ACCESS_ROWS.map((row) => {
          const off = row.access === "link" && linkOff && access !== "link";
          const Icon = row.icon;
          const checked = access === row.access;
          const label = organization || row.access !== "private" ? text(row.label) : text("onlyYou");
          const hint = off ? text("linkOff") : organization || row.access !== "private" ? text(row.hint) : text("onlyYouHint");
          return (
            <label key={row.access} className={`sr-choice${off ? " sr-off" : ""}`}>
              <input type="radio" name={`page-access-${pageId}`} value={row.access} checked={checked} disabled={off} onChange={() => choose(row.access)} />
              <span className={`sr-choice-icon${checked ? " sr-on" : ""}`}><Icon size={13} /></span>
              <span className="sr-row-text"><span>{label}</span><small>{hint}</small></span>
              {checked && <Check size={14} className="sr-check" aria-hidden="true" />}
            </label>
          );
        })}
        {pendingLink && (
          <div role="alert" className="sr-confirm">
            <span>{text("linkConfirm")}</span>
            <span className="sr-confirm-actions">
              <button type="button" className="sr-button sr-button-primary" onClick={() => choose("link")}>{text("confirm")}</button>
              <button type="button" className="sr-button" onClick={() => setPendingLink(false)}>{text("cancel")}</button>
            </span>
          </div>
        )}
      </fieldset>

      {error && <p role="alert" className="sr-error">{error}</p>}

      <button type="button" data-page-copy-link className="sr-button sr-button-wide" disabled={busy || !page} onClick={() => void copy()}>
        {copied ? <Check size={14} /> : <Link2 size={14} />}{copied ? text("copied") : text("copy")}
      </button>
    </div>
  );
}
