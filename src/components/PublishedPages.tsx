// Published pages (shared/published-pages.ts, server/routes/published-pages.ts).
//
// PagePublishCard is the approval card under a bot's propose_page row: the
// person previews the page in a sandboxed frame (opaque origin, no network)
// and only their Publish, with who can see it and until when, puts it
// online. PublishedPagesSettings is Settings > Pages publiées: every page of
// the person, its link, who can see it, its expiry, its versions, Revoke
// and Delete.
import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, FileText, Loader2, Maximize2, Trash2, XCircle } from "lucide-react";

import { t } from "@/lib/i18n";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { SettingsGroup, SettingsIntro, SettingsNotice, SettingsTextRow, SwitchRow } from "./SettingsPrimitives";
import { api, useStore, type Message } from "@/state/store";
import {
  PAGE_ACCESS,
  type PageAccess,
  type PagesPolicy,
  type PublishedPageSummary,
} from "../../shared/published-pages";
import { AccessPicker, ACCESS_LABEL, ExpirySelect, expiryFromHours, LinkRow, needsLinkConfirm, pageErrorText, previewSrc, usePagesPolicy, when } from "./page-controls";
import { PageViewerDialog } from "./PageViewer";

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

/** The approval card of a bot's proposal (message field `pagePublish`). */
export function PagePublishCard({ message }: { message: Message }) {
  const ref = message.pagePublish!;
  const [page, setPage] = useState<PublishedPageSummary | null>(null);
  const [missing, setMissing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [access, setAccess] = useState<PageAccess>("private");
  const [hours, setHours] = useState(0);
  const [confirmLink, setConfirmLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState(false);
  const openButton = useRef<HTMLButtonElement>(null);
  const policy = usePagesPolicy();

  const load = useCallback(async () => {
    try {
      const answer = await api<{ page: PublishedPageSummary }>(`/api/pages/${encodeURIComponent(ref.pageId)}`);
      setPage(answer.page);
    } catch {
      setMissing(true);
    }
  }, [ref.pageId]);
  useEffect(() => { void load(); }, [load]);

  const version = page?.versions.find((entry) => entry.n === ref.version);
  const act = async (path: string, body: unknown) => {
    setBusy(true);
    setError("");
    try {
      const answer = await api<{ page: PublishedPageSummary }>(`/api/pages/${encodeURIComponent(ref.pageId)}/${path}`, { method: "POST", body: JSON.stringify(body) });
      setPage(answer.page);
      setConfirmLink(false);
    } catch (cause) {
      setError(pageErrorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const publish = () => {
    if (access === "link" && !confirmLink) {
      setConfirmLink(true);
      return;
    }
    void act("publish", publishBody(ref.version, access, hours));
  };

  if (missing) {
    return <div className="chat-text w-fit max-w-[min(80%,560px)] rounded-[18px] bg-card px-3 py-[7px] text-[13px] text-ink">{message.text}</div>;
  }
  const live = page?.status === "published" && page.currentVersion === ref.version;
  const state = !version ? null : live ? "published" : version.state === "declined" ? "declined" : page?.currentVersion && page.currentVersion > ref.version ? "superseded" : "proposed";
  return (
    <article data-page-card={ref.pageId} aria-label={t("pages.cardAria", { title: ref.title })}
      className="my-2 w-full max-w-[640px] overflow-hidden rounded-xl border border-hairline/40 bg-panel shadow-sm">
      <header className="flex items-center gap-2 border-b border-hairline/30 bg-raised/30 px-3 py-2 text-[12px] text-ink-secondary">
        <FileText size={14} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{page?.title || ref.title}</span>
        <span>{t("pages.versionN", { n: String(ref.version) })}</span>
        {page && (
          <button ref={openButton} type="button" data-page-open aria-label={t("pages.openFull")} title={t("pages.openFull")} onClick={() => setViewing(true)}
            className="rounded p-1 text-ink-secondary hover:bg-hover hover:text-ink">
            <Maximize2 size={13} />
          </button>
        )}
      </header>
      {viewing && <PageViewerDialog pageId={ref.pageId} version={ref.version} returnFocus={openButton.current} onClose={() => setViewing(false)} onChange={setPage} />}
      <div className="space-y-3 px-3 py-3">
        {!page && <Loader2 size={14} className="animate-spin text-ink-secondary" />}
        {page && (
          <>
            <button type="button" onClick={() => setPreview((value) => !value)}
              className="flex items-center gap-1.5 text-[12.5px] text-accent hover:underline">
              {preview ? <EyeOff size={13} /> : <Eye size={13} />}{preview ? t("pages.hidePreview") : t("pages.preview")}
            </button>
            {preview && <PagePreviewFrame pageId={ref.pageId} version={ref.version} title={ref.title} />}
            {state === "proposed" && (
              <>
                <p className="text-[12px] text-ink-secondary">{t("pages.reviewIntro")}</p>
                <AccessPicker value={access} onChange={(next) => { setAccess(next); setConfirmLink(false); }} name={`page-access-${message.id}`} disabled={busy} linkOff={!policy.linkSharing} />
                <ExpirySelect value={hours} onChange={setHours} disabled={busy} />
                {confirmLink && <p role="alert" className="text-[12px] text-warning">{t("pages.confirmLink")}</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="button" data-page-publish disabled={busy} onClick={publish}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40">
                    {busy && <Loader2 size={13} className="animate-spin" />}{confirmLink ? t("pages.publishConfirm") : t("pages.publish")}
                  </button>
                  <button type="button" data-page-decline disabled={busy} onClick={() => void act("decline", { version: ref.version })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-hairline/60 px-3 py-1.5 text-[12.5px] text-ink hover:bg-raised disabled:opacity-40">
                    <XCircle size={13} />{t("pages.decline")}
                  </button>
                </div>
              </>
            )}
            {state === "published" && (
              <>
                <p className="text-[12px] text-success">{t("pages.publishedAs", { access: t(ACCESS_LABEL[page.access]) })}</p>
                <LinkRow page={page} />
              </>
            )}
            {state === "declined" && <p className="text-[12px] text-ink-secondary">{t("pages.declined")}</p>}
            {state === "superseded" && <p className="text-[12px] text-ink-secondary">{t("pages.superseded")}</p>}
            {page.status === "revoked" && state !== "declined" && <p className="text-[12px] text-ink-secondary">{t("pages.revokedNote")}</p>}
          </>
        )}
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </div>
    </article>
  );
}

function PageRow({ page, linkOff, onChange, onRemoved }: { page: PublishedPageSummary; linkOff: boolean; onChange(page: PublishedPageSummary): void; onRemoved(id: string): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [pendingAccess, setPendingAccess] = useState<PageAccess | null>(null);
  const [viewing, setViewing] = useState(false);
  const openButton = useRef<HTMLButtonElement>(null);
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
        <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] text-ink-secondary">{status}</span>
        <button ref={openButton} type="button" data-page-open aria-label={t("pages.openFull")} title={t("pages.openFull")} onClick={() => setViewing(true)}
          className="rounded p-1 text-ink-secondary hover:bg-hover hover:text-ink">
          <Maximize2 size={13} />
        </button>
      </div>
      {viewing && <PageViewerDialog pageId={page.id} returnFocus={openButton.current} onClose={() => setViewing(false)} onChange={onChange} />}
      <p className="text-[11.5px] text-ink-tertiary">
        {t("pages.updated", { when: when(page.updatedAt) })}
        {page.expiresAt !== null && ` · ${t("pages.expiresOn", { when: when(page.expiresAt) })}`}
      </p>
      {published && (
        <>
          <LinkRow page={page} />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[12.5px] text-ink">
              {t("pages.whoCanSee")}
              <select value={pendingAccess ?? page.access} disabled={busy} onChange={(event) => {
                const next = event.target.value as PageAccess;
                // the same second press as a first publish for a public link
                if (needsLinkConfirm(page.access, next)) return setPendingAccess(next);
                void call("", { method: "PATCH", body: JSON.stringify({ access: next }) });
              }}
                className="rounded-md border border-hairline/50 bg-panel px-2 py-1 text-[12.5px]">
                {PAGE_ACCESS.map((access) => <option key={access} value={access} disabled={access === "link" && linkOff && page.access !== "link"}>{t(ACCESS_LABEL[access])}</option>)}
              </select>
            </label>
            <ExpirySelect value={-1} disabled={busy} onChange={(hours) => void call("", { method: "PATCH", body: JSON.stringify({ expiresAt: expiryFromHours(hours) }) })} />
            {confirmRevoke ? (
              <span role="alert" className="flex items-center gap-2 text-[12px]">
                {t("pages.unpublishConfirm", { name: page.title })}
                <button type="button" data-page-revoke disabled={busy} onClick={() => { setConfirmRevoke(false); void call("/revoke", { method: "POST", body: "{}" }); }}
                  className="rounded px-1.5 py-1 text-danger hover:bg-danger/10 disabled:opacity-40">{t("pages.unpublish")}</button>
                <button type="button" onClick={() => setConfirmRevoke(false)} className="rounded px-1.5 py-1 text-ink-secondary hover:bg-hover">{t("pages.cancel")}</button>
              </span>
            ) : (
              <button type="button" disabled={busy} onClick={() => setConfirmRevoke(true)}
                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[12.5px] text-danger hover:bg-danger/10 disabled:opacity-40">
                <XCircle size={13} />{t("pages.unpublish")}
              </button>
            )}
          </div>
          {pendingAccess && (
            <span role="alert" className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-warning">{t("pages.confirmLinkChange")}</span>
              <button type="button" disabled={busy} onClick={() => { const next = pendingAccess; setPendingAccess(null); void call("", { method: "PATCH", body: JSON.stringify({ access: next }) }); }}
                className="rounded px-1.5 py-1 text-accent hover:bg-hover">{t("pages.publishConfirm")}</button>
              <button type="button" onClick={() => setPendingAccess(null)} className="rounded px-1.5 py-1 text-ink-secondary hover:bg-hover">{t("pages.cancel")}</button>
            </span>
          )}
          {linkOff && page.access === "link" && <p className="text-[12px] text-warning">{t("pages.linkOffActive")}</p>}
        </>
      )}
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
function OrganizationPages() {
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
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
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
export function PublishedPagesSettings() {
  const { state } = useStore();
  const policy = usePagesPolicy();
  const organization = usePerspicaxOrg() !== null;
  const admin = organization && (state.config?.viewer?.role === "admin" || state.config?.viewer?.role === "owner");
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
