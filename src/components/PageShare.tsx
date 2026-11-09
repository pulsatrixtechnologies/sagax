// Share a page (2026-10-28, the reference design's Share popover), the one
// place where a page's sharing is chosen, from the open page, the Library and
// Settings > Published pages:
//   - « Share "<title>" »;
//   - Add people or groups: the organization's people and teams (the
//     directory), invited by principal id or team id (POST /invite);
//   - who has access: the page's person (Owner), then those invited;
//   - General access: People you invite (private), Anyone in your
//     organization (org), Anyone with the link (link, only while the
//     organization's policy allows public links; switching to it asks a
//     second press);
//   - until when, Stop sharing, a newer version not shared yet;
//   - Copy link and Open in browser.
// A page not shared yet is shared by the person's own gesture here (choosing
// who can see it, adding someone, Copy link, Open in browser): the version on
// screen is published with the access chosen. Nothing else publishes it. The
// person shares their own page without an admin; the server checks every
// rule again (server/routes/published-pages.ts).
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, Globe, Link2, Loader2, Lock, Users, X, XCircle } from "lucide-react";

import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { usePerspicaxOrg, type OrgDirectoryPerson } from "@/lib/perspicax-org";
import { groupPeopleCandidates } from "@/lib/private-threads";
import { api, useStore } from "@/state/store";
import type { PageAccess, PublishedPageSummary } from "../../shared/published-pages";
import { initialsOf, needsLinkConfirm, pageReadingUrl, sharePlan, teamCandidates, withInvite, type ShareChange } from "@/lib/page-share-plan";
import { ExpirySelect, openReadingLink, pageErrorText } from "./page-controls";
import { useOrgDirectory } from "./GroupPeoplePicker";

export { sharePlan, teamCandidates, withInvite, type ShareChange, type ShareStep } from "@/lib/page-share-plan";

const ACCESS_ROWS: Array<{ access: PageAccess; icon: typeof Lock; label: "pages.share.invited" | "pages.share.org" | "pages.access.link"; hint: "pages.share.invitedHint" | "pages.access.orgHint" | "pages.access.linkHint" }> = [
  { access: "private", icon: Lock, label: "pages.share.invited", hint: "pages.share.invitedHint" },
  { access: "org", icon: Users, label: "pages.share.org", hint: "pages.access.orgHint" },
  { access: "link", icon: Globe, label: "pages.access.link", hint: "pages.access.linkHint" },
];

function Avatar({ name, url, team }: { name: string; url?: string; team?: boolean }) {
  if (url) return <img src={url} alt="" className="size-7 shrink-0 rounded-full object-cover" />;
  return (
    <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-raised text-[11px] font-semibold text-ink-secondary">
      {team ? <Users size={13} /> : initialsOf(name)}
    </span>
  );
}

export function PageSharePopover({ page, version, linkOff, onChange, onClose, className }: {
  page: PublishedPageSummary;
  /** The version on screen: the one a first share publishes. */
  version: number;
  /** The organization turned public links off. */
  linkOff: boolean;
  onChange(page: PublishedPageSummary): void;
  onClose(): void;
  className?: string;
}) {
  const { state } = useStore();
  const organization = usePerspicaxOrg() !== null;
  const directory = useOrgDirectory(organization);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingLink, setPendingLink] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && !ref.current?.contains(target) && !target.closest("[data-page-share]")) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const run = async (change: ShareChange): Promise<PublishedPageSummary | null> => {
    const steps = sharePlan(page, version, change);
    if (!steps.length) return page;
    setBusy(true);
    setError("");
    let next: PublishedPageSummary | null = null;
    try {
      for (const step of steps) {
        const answer = await api<{ page: PublishedPageSummary }>(`/api/pages/${encodeURIComponent(page.id)}${step.path}`, { method: step.method, body: JSON.stringify(step.body) });
        next = answer.page;
      }
      if (next) onChange(next);
      return next;
    } catch (cause) {
      setError(pageErrorText(cause));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const invites = page.invites ?? { people: [], teams: [] };
  const viewerId = state.config?.viewer?.principalId ?? null;
  const people = useMemo(() => new Map((directory?.people ?? []).map((person) => [person.principalId.toLowerCase(), person])), [directory]);
  const teams = useMemo(() => new Map((directory?.teams ?? []).map((team) => [team.id.toLowerCase(), team])), [directory]);
  const personCandidates = organization && query.trim()
    ? groupPeopleCandidates((directory?.people ?? []).filter((person) => !person.service), { taken: [...invites.people, ...(viewerId ? [viewerId] : [])], query, limit: 6 })
    : [];
  const groupCandidates = organization && query.trim() ? teamCandidates(directory?.teams ?? [], invites.teams, query, 4) : [];
  const shared = page.status === "published";
  const access = shared ? page.access : "private";

  const invite = (entry: { kind: "person" | "team"; id: string }, add: boolean) => {
    setQuery("");
    void run({ kind: "invites", invites: withInvite(invites, entry, add) });
  };
  const choose = (next: PageAccess) => {
    if (next === access && shared) return;
    if (needsLinkConfirm(shared ? page.access : "private", next) && !pendingLink) return setPendingLink(true);
    setPendingLink(false);
    void run({ kind: "access", access: next });
  };
  const withLink = async (use: (url: string) => void) => {
    const next = await run({ kind: "link" });
    // the page's reading link only, never the app's address
    const link = pageReadingUrl(next?.url);
    if (link) use(link);
  };
  const ownerName = (viewerId && people.get(viewerId.toLowerCase())?.name) || state.config?.profile?.name?.trim() || t("pages.share.you");

  return (
    <div ref={ref} role="dialog" aria-label={t("pages.share.title", { title: page.title })} data-page-share-popover={page.id}
      className={`w-[min(400px,calc(100vw-24px))] rounded-2xl border border-hairline/50 bg-elevated p-4 text-ink shadow-2xl ${className ?? ""}`}>
      <div className="mb-3 flex items-start gap-2">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{t("pages.share.title", { title: page.title || t("pages.untitled") })}</h2>
        {busy && <Loader2 size={14} className="mt-1 animate-spin text-ink-secondary" />}
      </div>

      {organization && (
        <div className="relative mb-3">
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200}
            placeholder={t("pages.share.add")} aria-label={t("pages.share.add")} data-page-share-search
            className="w-full rounded-xl border border-hairline/50 bg-inset px-3 py-2 text-[13px] placeholder:text-ink-tertiary focus:border-accent/60 focus:outline-none" />
          {query.trim() && (
            <ul role="listbox" aria-label={t("pages.share.add")} className="absolute inset-x-0 top-full z-[1] mt-1 max-h-64 overflow-y-auto rounded-xl border border-hairline/50 bg-elevated p-1 shadow-xl">
              {personCandidates.map((person: OrgDirectoryPerson) => (
                <li key={person.principalId}>
                  <button type="button" role="option" aria-selected="false" disabled={busy} onClick={() => invite({ kind: "person", id: person.principalId }, true)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover disabled:opacity-40">
                    <Avatar name={person.name || person.login} {...(person.avatarUrl ? { url: person.avatarUrl } : {})} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{person.name || person.login}</span>
                      {person.email && <span className="block truncate text-[11.5px] text-ink-secondary">{person.email}</span>}
                    </span>
                  </button>
                </li>
              ))}
              {groupCandidates.map((team) => (
                <li key={team.id}>
                  <button type="button" role="option" aria-selected="false" disabled={busy} onClick={() => invite({ kind: "team", id: team.id }, true)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover disabled:opacity-40">
                    <Avatar name={team.name} team />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{team.name}</span>
                      <span className="block truncate text-[11.5px] text-ink-secondary">{t("pages.share.group", { count: String(new Set([...team.members, ...team.managers]).size) })}</span>
                    </span>
                  </button>
                </li>
              ))}
              {directory && personCandidates.length === 0 && groupCandidates.length === 0 && <li className="px-2 py-1.5 text-[12.5px] text-ink-secondary">{t("pages.share.noMatch")}</li>}
            </ul>
          )}
        </div>
      )}

      <ul aria-label={t("pages.share.people")} className="mb-3 flex flex-col gap-1.5">
        <li className="flex items-center gap-2.5">
          <Avatar name={ownerName} {...(viewerId && people.get(viewerId.toLowerCase())?.avatarUrl ? { url: people.get(viewerId.toLowerCase())!.avatarUrl! } : {})} />
          <span className="min-w-0 flex-1 truncate text-[13px]">{ownerName}</span>
          <span className="text-[12px] text-ink-secondary">{t("pages.share.owner")}</span>
        </li>
        {invites.people.map((id) => {
          const person = people.get(id.toLowerCase());
          const name = person?.name || person?.login || t("pages.share.someone");
          return (
            <li key={`p:${id}`} data-page-invite={id} className="flex items-center gap-2.5">
              <Avatar name={name} {...(person?.avatarUrl ? { url: person.avatarUrl } : {})} />
              <span className="min-w-0 flex-1 truncate text-[13px]" title={person?.email}>{name}</span>
              <button type="button" disabled={busy} aria-label={t("pages.share.remove", { name })} title={t("pages.share.remove", { name })} onClick={() => invite({ kind: "person", id }, false)}
                className="rounded-full p-1 text-ink-secondary hover:bg-hover hover:text-ink disabled:opacity-40"><X size={13} /></button>
            </li>
          );
        })}
        {invites.teams.map((id) => {
          const team = teams.get(id.toLowerCase());
          const name = team?.name || t("pages.share.someGroup");
          return (
            <li key={`t:${id}`} data-page-invite={id} className="flex items-center gap-2.5">
              <Avatar name={name} team />
              <span className="min-w-0 flex-1 truncate text-[13px]">{name}</span>
              <button type="button" disabled={busy} aria-label={t("pages.share.remove", { name })} title={t("pages.share.remove", { name })} onClick={() => invite({ kind: "team", id }, false)}
                className="rounded-full p-1 text-ink-secondary hover:bg-hover hover:text-ink disabled:opacity-40"><X size={13} /></button>
            </li>
          );
        })}
      </ul>

      <fieldset className="mb-3" disabled={busy}>
        <legend className="mb-1.5 text-[12px] font-medium text-ink-secondary">{t("pages.share.general")}</legend>
        <div className="flex flex-col gap-0.5">
          {ACCESS_ROWS.map((row) => {
            const off = row.access === "link" && linkOff && page.access !== "link";
            const Icon = row.icon;
            // a page not shared yet reads as "People you invite" until a gesture shares it
            const checked = access === row.access;
            return (
              <label key={row.access} className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 ${off ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-hover"}`}>
                <input type="radio" name={`page-access-${page.id}`} value={row.access} checked={checked} disabled={off} onChange={() => choose(row.access)} className="sr-only" />
                <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${checked ? "bg-accent text-white" : "bg-raised text-ink-secondary"}`}><Icon size={13} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px]">{organization || row.access !== "private" ? t(row.label) : t("pages.access.private")}</span>
                  <span className="block text-[11.5px] text-ink-tertiary">{off ? t("pages.linkOff") : organization || row.access !== "private" ? t(row.hint) : t("pages.access.privateHint")}</span>
                </span>
                {checked && <Check size={14} className="mt-1.5 text-accent" aria-hidden="true" />}
              </label>
            );
          })}
        </div>
        {pendingLink && (
          <div role="alert" className="mt-2 flex flex-col gap-2 rounded-lg bg-warning/10 p-2 text-[12px]">
            <span className="text-warning">{t("pages.confirmLinkChange")}</span>
            <span className="flex gap-2">
              <button type="button" className="rounded-lg bg-accent px-2.5 py-1 font-medium text-white" onClick={() => choose("link")}>{t("pages.publishConfirm")}</button>
              <button type="button" className="rounded-lg px-2.5 py-1 text-ink-secondary hover:bg-hover" onClick={() => setPendingLink(false)}>{t("pages.cancel")}</button>
            </span>
          </div>
        )}
        {linkOff && page.access === "link" && shared && <p className="mt-1.5 text-[12px] text-warning">{t("pages.linkOffActive")}</p>}
      </fieldset>

      <fieldset className="mb-3" disabled={busy} data-page-bot-scope="">
        <legend className="mb-1.5 text-[12px] font-medium text-ink-secondary">{t("pages.share.bot.legend")}</legend>
        <div className="flex flex-col gap-0.5">
          {([false, true] as const).map((value) => {
            const checked = (page.botShared === true) === value;
            return (
              <label key={String(value)} className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-hover">
                <input type="radio" name={`page-bot-scope-${page.id}`} value={value ? "shared" : "personal"} checked={checked} onChange={() => void run({ kind: "bot", shared: value })} className="sr-only" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px]">{value ? t("pages.share.bot.shared") : t("pages.share.bot.personal")}</span>
                  <span className="block text-[11.5px] text-ink-tertiary">{value ? t("pages.share.bot.sharedHint") : t("pages.share.bot.personalHint")}</span>
                </span>
                {checked && <Check size={14} className="mt-1.5 text-accent" aria-hidden="true" />}
              </label>
            );
          })}
        </div>
      </fieldset>

      {!shared && <p className="mb-3 text-[12px] text-ink-secondary">{t("pages.share.notShared", { n: String(version) })}</p>}
      {shared && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
          <ExpirySelect value={-1} disabled={busy} onChange={(hours) => void run({ kind: "expiry", hours })} />
          {page.currentVersion !== version && (
            <button type="button" disabled={busy} className="text-accent hover:underline disabled:opacity-40" onClick={() => void run({ kind: "version" })}>
              {t("pages.share.newVersion", { n: String(version) })}
            </button>
          )}
          <button type="button" data-page-unpublish disabled={busy} className="inline-flex items-center gap-1 text-danger hover:underline disabled:opacity-40" onClick={() => void run({ kind: "stop" })}>
            <XCircle size={12} />{t("pages.unpublish")}
          </button>
          {page.reachable === false && <span className="text-warning">{t("pages.localOnly")}</span>}
        </div>
      )}

      {shared && page.url && <p data-page-share-url className="mb-2 truncate text-[11.5px] text-ink-tertiary" title={page.url}>{page.url}</p>}
      {error && <p role="alert" className="mb-2 text-[12px] text-danger">{error}</p>}

      <div className="flex items-center gap-2">
        <button type="button" data-page-copy-link disabled={busy}
          onClick={() => void withLink((url) => void copyText(url).then((result) => { setCopied(result === "copied"); if (result === "copied") setTimeout(() => setCopied(false), 1600); }))}
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-hairline/60 bg-raised px-3 text-[13px] font-medium hover:bg-raised-hover disabled:opacity-40">
          {copied ? <Check size={14} className="text-success" /> : <Link2 size={14} />}{copied ? t("pages.share.copied") : t("pages.share.copy")}
        </button>
        <button type="button" data-page-open-browser disabled={busy} onClick={() => void withLink(openReadingLink)}
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-ink px-3 text-[13px] font-medium text-app hover:opacity-90 disabled:opacity-40">
          <ExternalLink size={14} />{t("pages.share.browser")}
        </button>
      </div>
    </div>
  );
}
