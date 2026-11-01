// Published pages (shared/published-pages.ts, server/routes/published-pages.ts).
//
// PagePublishCard is the page's card under a bot's propose_page row: a live
// drawing of the page (a sandboxed frame, opaque origin, no network); a
// click opens the page over the conversation, where only the person's Share
// (who can see it and until when) puts it online. PublishedPagesSettings is Settings > Pages publiées: every page of
// the person, its link, who can see it, its expiry, its versions, Revoke
// and Delete.
import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2, Maximize2, Pin, Share, Trash2, XCircle } from "lucide-react";

import { t } from "@/lib/i18n";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { PillSelect, SettingsGroup, SettingsIntro, SettingsNotice, SettingsTextRow, SwitchRow } from "./SettingsPrimitives";
import { api, useStore, type Message } from "@/state/store";
import { shareAudienceBody } from "../../shared/page-audience";
import {
  type PageAccess,
  type PagesPolicy,
  type PublishedPageSummary,
} from "../../shared/published-pages";
import { ACCESS_LABEL, expiryFromHours, pageErrorText, pageGone, previewSrc, usePagesPolicy, when } from "./page-controls";
import { PageFrame, PageGlyph } from "./PageViewer";
import { PageSharePopover } from "./PageShare";
import { useWidgetTheme } from "./WidgetFrame";
import { encodeSkinTokens } from "@/lib/page-theme";
import { openPage } from "@/lib/open-page";
import { pageCardOpenVersion, pageCardStatusWithThreadLatest } from "@/lib/page-chat-layout";
import { readableError } from "@/lib/plain-error";

export { expiryFromHours, previewSrc };

/** The body of POST /api/pages/:id/publish. Pure. */
export function publishBody(version: number, access: PageAccess, hours: number, now = Date.now()) {
  return { version, access, expiresAt: expiryFromHours(hours, now) };
}

/** One version, previewed exactly as readers get it: the server's wrapper
 * (banner "not a Sagax screen", no script) framing the page in a sandbox
 * with scripts only, its frame pinned by CSP to its own path. The app never
 * hands the page a srcdoc; the desktop app also blocks any navigation of
 * that frame other than its own address (electron/page-frame-guard.mjs). */
export function PagePreviewFrame({ pageId, version, title }: { pageId: string; version: number; title: string }) {
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api<{ version: { previewPath: string } }>(`/api/pages/${encodeURIComponent(pageId)}/versions/${version}`)
      .then((answer) => {
        if (!live) return;
        const src = previewSrc(answer.version.previewPath);
        if (src) setPath(src);
        else setError(t("pages.previewUnavailable"));
      })
      .catch((cause) => { if (live) setError(pageErrorText(cause)); });
    return () => { live = false; };
  }, [pageId, version]);
  if (error) return <p role="alert" className="text-[12px] text-danger">{error}</p>;
  if (path === null) return <Loader2 size={14} className="animate-spin text-ink-secondary" />;
  return (
    <iframe
      data-page-preview
      title={t("pages.previewTitle", { title })}
      src={path}
      referrerPolicy="no-referrer"
      allow=""
      className="h-[400px] w-full rounded-lg border border-hairline/40 bg-white"
    />
  );
}

/** The card's one line under the title: "Page" and where this version
 * stands. Pure. */
export function pageCardState(page: Pick<PublishedPageSummary, "status" | "currentVersion" | "versions"> | null, version: number): "proposed" | "published" | "declined" | "superseded" | "revoked" | "draft" | null {
  const entry = page?.versions.find((item) => item.n === version);
  if (!page || !entry) return null;
  if (page.status === "published" && page.currentVersion === version) return "published";
  if (entry.state === "declined") return "declined";
  if (page.currentVersion && page.currentVersion > version) return "superseded";
  if (page.versions.some((item) => item.n > version)) return "superseded";
  if (page.status === "revoked") return "revoked";
  return page.status === "published" ? "proposed" : "draft";
}

/** A page in the conversation (message field `pagePublish`, 2026-10-28, the
 * reference design's page card): a live, scaled-down drawing of the top of
 * the page fading out at the bottom, then its icon, its title and "Page".
 * A click opens it in the conversation frame (src/lib/open-page.ts): beside
 * the chat on desktop, full screen on a phone. A superseded card says
 * "Updated below" and opens the latest version. Share puts it online. The
 * drawing is the same sandboxed preview as the open page, inert here.
 *
 * `threadLatestVersion`: newest version this conversation names for the same
 * page. When the bot appends v2 while a v1 card stays mounted, the summary
 * reloads and the label / open intention flip to Updated below → latest.
 * Deliberate opens of a non-superseded card version stay on that version. */
export function PagePublishCard({ message, threadLatestVersion }: { message: Message; threadLatestVersion?: number }) {
  const ref = message.pagePublish!;
  const [page, setPage] = useState<PublishedPageSummary | null>(null);
  const [missing, setMissing] = useState(false);
  // deleted (the server's 404): the card stays, said "Page deleted"
  const [deleted, setDeleted] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  // no preview to draw: a neutral line in its place, never a spinner forever
  const [noPreview, setNoPreview] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const look = useWidgetTheme(cardRef);
  const theme = look.scheme;
  const skin = useMemo(() => encodeSkinTokens(look.tokens), [look]);

  useEffect(() => {
    let live = true;
    setMissing(false);
    setDeleted(false);
    api<{ page: PublishedPageSummary }>(`/api/pages/${encodeURIComponent(ref.pageId)}`)
      .then((answer) => { if (live) setPage(answer.page); })
      .catch((cause) => { if (!live) return; if (pageGone(cause)) setDeleted(true); else setMissing(true); });
    // Thumbnail stays on this card's version; only the summary reloads on a
    // newer thread version so Updated below / open-latest stay correct.
    api<{ version: { previewPath: string } }>(`/api/pages/${encodeURIComponent(ref.pageId)}/versions/${ref.version}`)
      .then((answer) => { if (live) setPreviewPath(answer.version.previewPath); })
      .catch(() => { if (live) setNoPreview(true); });
    return () => { live = false; };
  }, [ref.pageId, ref.version, threadLatestVersion]);

  if (missing) {
    return <div className="chat-text w-fit max-w-[min(80%,560px)] rounded-[18px] bg-card px-3 py-[7px] text-[13px] text-ink">{message.text}</div>;
  }
  const title = page?.title || ref.title;
  const loadedStatus = deleted ? "deleted" : pageCardState(page, ref.version);
  const status = pageCardStatusWithThreadLatest(loadedStatus, ref.version, threadLatestVersion);
  // the page's own preview address, and nothing else, is ever framed: any
  // other answer (an older server, a bad path) is "Preview unavailable"
  const src = !deleted && previewPath ? previewSrc(previewPath, { bare: true, theme, skin }) : null;
  const unavailable = deleted || noPreview || (previewPath !== null && src === null);
  // the page names its own bot and conversation; Updated below opens latest
  const open = () => {
    if (!page) return;
    const version = pageCardOpenVersion(status, ref.version);
    void openPage({ pageId: ref.pageId, botId: page.botId, threadId: page.threadId, title, ...(version !== undefined ? { version } : {}) });
  };
  const stateLine = status === "deleted"
    ? ` · ${t("pages.card.deleted")}`
    : status === "superseded"
      ? ` · ${t("pages.card.updatedBelow")}`
      : status && status !== "draft"
        ? ` · ${status === "published" && page
          ? t("pages.card.published", { access: page.access === "private" && ((page.invites?.people.length ?? 0) + (page.invites?.teams.length ?? 0)) > 0 ? t("pages.share.invited") : t(ACCESS_LABEL[page.access]) })
          : t(`pages.card.${status}`, { n: String(ref.version) })}`
        : "";
  return (
    <article ref={cardRef} data-page-card={ref.pageId} data-page-card-version={ref.version} aria-label={t("pages.cardAria", { title })}
      className="group relative my-2 w-full max-w-[420px] overflow-hidden rounded-2xl border border-hairline/50 bg-card shadow-sm transition-shadow hover:shadow-md">
      <div data-page-thumb aria-hidden="true" className="relative h-[200px] overflow-hidden bg-app">
        {src ? (
          <PageFrame src={src} theme={theme} thumbnail className="pointer-events-none absolute left-0 top-0 h-[400px] w-[200%] origin-top-left scale-50" />
        ) : unavailable ? (
          <div data-page-thumb-unavailable className="flex h-full items-center justify-center text-[12px] text-ink-tertiary">{deleted ? t("pages.card.deleted") : t("pages.previewUnavailableShort")}</div>
        ) : (
          <div className="flex h-full items-center justify-center"><Loader2 size={14} className="animate-spin text-ink-secondary" /></div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-card" />
      </div>
      <footer className="flex items-center gap-2.5 px-3 pb-3 pt-1">
        <PageGlyph size={28} className="rounded-lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-ink">{title}</span>
          <span data-page-card-state={status ?? ""} className="block truncate text-[12px] text-ink-secondary">
            {t("pages.label")}{stateLine}
          </span>
        </span>
      </footer>
      <button type="button" data-page-open aria-label={t("pages.cardOpen", { title })} disabled={!page} onClick={open}
        className="absolute inset-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
    </article>
  );
}

/** The person's audience. Rooms and groups are the ones already in the
 * app. An empty list is said as empty. Nothing is invented. */
function PageAudienceRow({ page, busy, onShare }: { page: PublishedPageSummary; busy: boolean; onShare(body: { audience: string; id?: string }): void }) {
  const { state } = useStore();
  const mark = page.audience?.kind === "room" || page.audience?.kind === "group" ? `${page.audience.kind}:${page.audience.id}` : "person";
  const [kind, setKind] = useState(page.audience?.kind ?? "person");
  const [id, setId] = useState(page.audience?.kind === "room" || page.audience?.kind === "group" ? page.audience.id : "");
  useEffect(() => {
    if (page.audience?.kind === "room" || page.audience?.kind === "group") {
      setKind(page.audience.kind);
      setId(page.audience.id);
    } else {
      setKind("person");
      setId("");
    }
  }, [mark]);
  const places = state.groups;
  const body = shareAudienceBody(kind, id);
  const known = places.some((group) => group.id === id);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink">
        <span>{t("pages.audience")}</span>
        <PillSelect
          ariaLabel={t("pages.audience")}
          value={kind}
          disabled={busy}
          onChange={(next) => { setKind(next); if (next === "person") setId(""); }}
          options={[
            { value: "person", label: t("pages.audience.person") },
            { value: "room", label: t("pages.audience.room") },
            { value: "group", label: t("pages.audience.group") },
          ]}
        />
        {kind !== "person" && (
          <select aria-label={t("pages.audience.pick")} disabled={busy || places.length === 0} value={id} onChange={(event) => setId(event.target.value)}
            className="max-w-48 rounded border border-hairline/60 bg-raised px-2 py-1 text-[12px] text-ink">
            <option value="">{places.length === 0 ? t("pages.audience.none") : t("pages.audience.pick")}</option>
            {places.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            {!known && id ? <option value={id}>{id}</option> : null}
          </select>
        )}
        <button type="button" disabled={busy || !body} onClick={() => { if (body) onShare(body); }}
          className="rounded px-1.5 py-1 text-accent hover:bg-hover disabled:opacity-40">{t("pages.audience.share")}</button>
      </div>
      {kind === "person" && <p className="text-[11.5px] text-ink-tertiary">{t("pages.audience.personHint")}</p>}
    </div>
  );
}

function PageRow({ page, linkOff, onChange, onRemoved }: { page: PublishedPageSummary; linkOff: boolean; onChange(page: PublishedPageSummary): void; onRemoved(id: string): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sharing, setSharing] = useState(false);
  const call = async (path: string, init: RequestInit) => {
    setBusy(true);
    setError("");
    try {
      const answer = await api<{ page?: PublishedPageSummary }>(`/api/pages/${encodeURIComponent(page.id)}${path}`, init);
      if (answer.page) onChange(answer.page);
      else onRemoved(page.id);
    } catch (cause) {
      setError(pageErrorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const published = page.status === "published";
  const status = published ? (page.expired ? t("pages.status.expired") : t("pages.status.published")) : page.status === "revoked" ? t("pages.status.revoked") : t("pages.status.draft");
  return (
    <li data-published-page={page.id} className="space-y-2 px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <FileText size={14} aria-hidden="true" className="text-ink-secondary" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{page.title}</span>
        <button type="button" aria-pressed={page.pinned === true} disabled={busy} onClick={() => void call("", { method: "PATCH", body: JSON.stringify({ pinned: page.pinned !== true }) })}
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-ink-secondary hover:bg-hover hover:text-ink disabled:opacity-40">
          <Pin size={12} />{page.pinned ? t("pages.unpin") : t("pages.pin")}
        </button>
        <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] text-ink-secondary">{status}</span>
        <button type="button" data-page-open aria-label={t("pages.openWindow")} title={t("pages.openWindow")} onClick={() => void openPage({ pageId: page.id, botId: page.botId, threadId: page.threadId, title: page.title }, "window")}
          className="rounded p-1 text-ink-secondary hover:bg-hover hover:text-ink">
          <Maximize2 size={13} />
        </button>
      </div>
      <PageAudienceRow page={page} busy={busy} onShare={(body) => void call("/share", { method: "POST", body: JSON.stringify(body) })} />
      <p className="text-[12px] text-ink-secondary">{t("pages.coedit")}</p>
      <SwitchRow label={t("pages.keepUpdated")} description={t("pages.keepUpdatedHint")} checked={page.keepUpdated === true} disabled={busy}
        onChange={(next) => void call("", { method: "PATCH", body: JSON.stringify({ keepUpdated: next }) })} />
      <p className="text-[11.5px] text-ink-tertiary">
        {t("pages.updated", { when: when(page.updatedAt) })}
        {page.expiresAt !== null && ` · ${t("pages.expiresOn", { when: when(page.expiresAt) })}`}
      </p>
      {/* sharing: the one Share popover (src/components/PageShare.tsx) */}
      <div className="relative flex flex-wrap items-center gap-2 text-[12px]">
        {published && <span className="text-ink-secondary">{t("pages.card.published", { access: page.access === "private" && ((page.invites?.people.length ?? 0) + (page.invites?.teams.length ?? 0)) > 0 ? t("pages.share.invited") : t(ACCESS_LABEL[page.access]) })}</span>}
        <button type="button" data-page-share aria-expanded={sharing} aria-haspopup="dialog" onClick={() => setSharing((open) => !open)}
          className="inline-flex items-center gap-1 rounded-full border border-hairline/60 px-2.5 py-1 text-ink hover:bg-raised">
          <Share size={12} />{t("pages.shareMenu")}
        </button>
        {sharing && (
          <PageSharePopover page={page} version={page.currentVersion ?? page.versions.at(-1)?.n ?? 1} linkOff={linkOff} onChange={onChange} onClose={() => setSharing(false)}
            className="absolute left-0 top-full z-[5] mt-1" />
        )}
      </div>
      <details className="text-[12px]">
        <summary className="cursor-pointer text-ink-secondary">{t("pages.versions", { count: String(page.versions.length) })}</summary>
        <ul className="mt-1.5 space-y-1.5">
          {page.versions.slice().reverse().map((version) => (
            <li key={version.n} className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-ink">{t("pages.versionN", { n: String(version.n) })}</span>
                <span className="text-ink-tertiary">{when(version.createdAt)}</span>
                {page.currentVersion === version.n && <span className="text-success">{t("pages.status.published")}</span>}
                {version.state === "declined" && <span className="text-ink-tertiary">{t("pages.status.declined")}</span>}
                <button type="button" onClick={() => setPreviewing(previewing === version.n ? null : version.n)} className="text-accent hover:underline">
                  {previewing === version.n ? t("pages.hidePreview") : t("pages.preview")}
                </button>
                {published && page.currentVersion !== version.n && version.state !== "declined" && (
                  <button type="button" disabled={busy} onClick={() => void call("/publish", { method: "POST", body: JSON.stringify({ version: version.n, access: page.access, expiresAt: page.expiresAt !== null && page.expiresAt > Date.now() ? page.expiresAt : null }) })}
                    className="text-accent hover:underline disabled:opacity-40">{t("pages.publishThis")}</button>
                )}
              </div>
              {previewing === version.n && <PagePreviewFrame pageId={page.id} version={version.n} title={version.title} />}
            </li>
          ))}
        </ul>
      </details>
      <div className="flex justify-end">
        {confirmDelete ? (
          <span className="flex items-center gap-2 text-[12px]">
            {t("pages.deleteConfirm")}
            <button type="button" disabled={busy} onClick={() => void call("", { method: "DELETE" })} className="rounded px-1.5 py-1 text-danger hover:bg-danger/10">{t("pages.delete")}</button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="rounded px-1.5 py-1 text-ink-secondary hover:bg-hover">{t("pages.cancel")}</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-ink-secondary hover:bg-hover">
            <Trash2 size={12} />{t("pages.delete")}
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </li>
  );
}

/** Organization admins: every page of the server, and Revoke (audited on
 * the server). No content, no publish, no access change from here. */
/** Every published page of the organization and its sharing rules: an
 * organization admin's, in Settings > Organization (2026-10-26). */
export function OrganizationPages() {
  const [pages, setPages] = useState<Array<PublishedPageSummary & { ownerId: string | null }> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [policy, setPolicy] = useState<PagesPolicy | null>(null);
  useEffect(() => {
    api<PagesPolicy>("/api/admin/pages/policy").then(setPolicy).catch(() => setPolicy(null));
  }, []);
  const switchPolicy = async (change: Partial<PagesPolicy>) => {
    setBusy("policy");
    setError("");
    try {
      setPolicy(await api<PagesPolicy>("/api/admin/pages/policy", { method: "PUT", body: JSON.stringify(change) }));
    } catch (cause) {
      setError(pageErrorText(cause));
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => {
    api<{ pages: Array<PublishedPageSummary & { ownerId: string | null }> }>("/api/admin/pages")
      .then((answer) => setPages(answer.pages))
      .catch((cause) => setError(readableError(cause)));
  }, []);
  const revoke = async (id: string) => {
    setBusy(id);
    setError("");
    try {
      const answer = await api<{ page: PublishedPageSummary & { ownerId: string | null } }>(`/api/admin/pages/${encodeURIComponent(id)}/revoke`, { method: "POST", body: "{}" });
      setPages((current) => (current ?? []).map((entry) => (entry.id === id ? answer.page : entry)));
    } catch (cause) {
      setError(pageErrorText(cause));
    } finally {
      setBusy(null);
    }
  };
  const live = (pages ?? []).filter((page) => page.status === "published");
  return (
    <div data-settings-card="pages.organization">
      <SettingsGroup title={t("pages.admin.title")} groupId="pages.organization">
        <SettingsTextRow>{t("pages.admin.intro")}</SettingsTextRow>
        {policy && (
          <div className="px-3.5 py-2.5">
            <SwitchRow label={t("pages.admin.linkSharing")} description={t("pages.admin.linkSharingHint")} checked={policy.linkSharing}
              disabled={busy === "policy"} onChange={(next) => void switchPolicy({ linkSharing: next })} />
            <SwitchRow className="mt-3" label={t("pages.admin.readerComments")} description={t("pages.admin.readerCommentsHint")} checked={policy.readerComments}
              disabled={busy === "policy"} onChange={(next) => void switchPolicy({ readerComments: next })} />
          </div>
        )}
        {pages !== null && live.length === 0 && <SettingsTextRow>{t("pages.admin.empty")}</SettingsTextRow>}
        {live.length > 0 && <ul className="flex flex-col">
          {live.map((page) => (
            <li key={page.id} data-admin-page={page.id} className="flex min-h-[44px] items-center gap-2 px-3.5 py-2 text-[13px] leading-[18px]">
              <span className="min-w-0 flex-1 truncate text-ink">{page.title}</span>
              <span className="text-ink-tertiary">{t(ACCESS_LABEL[page.access])}</span>
              <button type="button" disabled={busy === page.id} onClick={() => void revoke(page.id)}
                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-danger hover:bg-danger/10 disabled:opacity-40">
                <XCircle size={13} />{t("pages.revoke")}
              </button>
            </li>
          ))}
        </ul>}
        {error && <SettingsTextRow tone="danger">{error}</SettingsTextRow>}
      </SettingsGroup>
    </div>
  );
}

/** Settings > Pages publiées. */
export function PublishedPagesSettings({ personal = false }: {
  /** Connect apps > Pages (2026-10-26, under Providers until 2026-10-28): the person's own pages only, with the
   * empty line while they have none (it is a tab of its own; the
   * organization's pages are in Settings > Organization) */
  personal?: boolean;
} = {}) {
  const { state } = useStore();
  const policy = usePagesPolicy();
  const organization = usePerspicaxOrg() !== null;
  const admin = !personal && organization && (state.config?.viewer?.role === "admin" || state.config?.viewer?.role === "owner");
  const [pages, setPages] = useState<PublishedPageSummary[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ pages: PublishedPageSummary[] }>("/api/pages")
      .then((answer) => setPages(answer.pages))
      .catch((cause) => { setPages([]); setError(pageErrorText(cause)); });
  }, []);
  return (
    <section data-settings-card="pages" className="flex min-w-0 flex-col gap-3">
      <SettingsIntro>{t("pages.settingsIntro")}</SettingsIntro>
      {error && <SettingsNotice tone="danger">{error}</SettingsNotice>}
      <SettingsGroup title={t("pages.yours")} groupId="pages.yours">
        {pages === null && <div className="px-3.5 py-2.5"><Loader2 size={14} className="animate-spin text-ink-secondary" /></div>}
        {pages?.length === 0 && !error && <SettingsTextRow>{t("pages.empty")}</SettingsTextRow>}
        {pages && pages.length > 0 && (
          <ul className="flex flex-col">
            {pages.map((page) => (
              <PageRow key={page.id} page={page} linkOff={!policy.linkSharing}
                onChange={(next) => setPages((current) => (current ?? []).map((entry) => (entry.id === next.id ? next : entry)))}
                onRemoved={(id) => setPages((current) => (current ?? []).filter((entry) => entry.id !== id))} />
            ))}
          </ul>
        )}
      </SettingsGroup>
      {admin && <OrganizationPages />}
    </section>
  );
}
