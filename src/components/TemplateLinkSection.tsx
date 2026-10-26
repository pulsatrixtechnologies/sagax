// Share preset > Share the link (server/template-links.ts): the same preset
// frozen as a template behind a signed public link that anyone can open as a
// read-only card and import from (Browse bots > Templates > Import). Starter
// notes never go into a link, whatever the file choice above says. Each link
// can be copied and turned off; turning it off is immediate and final.
// Update the template (2026-10-21) freezes the name, description and picture
// above, with the current defaults, under the same link: people who have it
// see the new version. View the shared copy opens the public card.
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Link2, Link2Off, Loader2, RefreshCw } from "lucide-react";

import { openExternalLink } from "@/lib/app-links";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";

export interface TemplateLink {
  id: string;
  name: string;
  createdAt: number;
  /** When the template behind the link was last updated. */
  updatedAt?: number;
  path: string;
  url: string;
  /** False when the address is this computer only (127.0.0.1). */
  reachable: boolean;
}

/** The body of POST /api/template-links. Never starter notes. Pure. */
export function templateLinkBody(choices: { name: string; description: string; picture?: string }): Record<string, string> {
  const name = choices.name.trim();
  const description = choices.description.trim();
  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(choices.picture ? { picture: choices.picture } : {}),
  };
}

export function TemplateLinkSection({ name, description, picture, request = api }: {
  name: string;
  description: string;
  picture?: string;
  request?: typeof api;
}) {
  const [links, setLinks] = useState<TemplateLink[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const answer = await request<{ links: TemplateLink[] }>("/api/template-links");
      setLinks(answer.links);
    } catch {
      setLinks([]);
    }
  }, [request]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const answer = await request<{ link: TemplateLink }>("/api/template-links", { method: "POST", body: JSON.stringify(templateLinkBody({ name, description, picture })) });
      setLinks((current) => [...(current ?? []), answer.link]);
      if ((await copyText(answer.link.url)) === "copied") setCopied(answer.link.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await request(`/api/template-links/${id}`, { method: "DELETE" });
      setLinks((current) => (current ?? []).filter((link) => link.id !== id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const update = async (id: string) => {
    setBusy(true);
    setError("");
    setUpdated(null);
    try {
      const answer = await request<{ link: TemplateLink }>(`/api/template-links/${id}`, { method: "PUT", body: JSON.stringify(templateLinkBody({ name, description, picture })) });
      setLinks((current) => (current ?? []).map((link) => (link.id === id ? answer.link : link)));
      setUpdated(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const copy = async (link: TemplateLink) => {
    if ((await copyText(link.url)) === "copied") setCopied(link.id);
  };

  return (
    <section data-template-links className="mt-5 rounded-xl border border-hairline/50 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-ink"><Link2 size={14} aria-hidden="true" />{t("templateLink.title")}</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("templateLink.intro")}</p>
        </div>
        <button type="button" data-template-link-create disabled={busy} onClick={() => void create()}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline/60 px-3 py-1.5 text-[12.5px] text-ink hover:bg-raised disabled:opacity-40">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} aria-hidden="true" />}
          {t("templateLink.create")}
        </button>
      </div>
      {links && links.length > 0 && (
        <ul className="mt-3 space-y-2">
          {links.map((link) => (
            <li key={link.id} data-template-link={link.id} className="rounded-lg bg-raised/45 px-3 py-2 text-[12px]">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-ink" title={link.url}>{link.url}</span>
                <button type="button" onClick={() => void copy(link)} aria-label={t("templateLink.copy")} title={t("templateLink.copy")}
                  className="rounded p-1 text-ink-secondary hover:bg-hover hover:text-ink">
                  {copied === link.id ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                </button>
                <button type="button" data-template-link-view onClick={() => void openExternalLink(link.url)} aria-label={t("templateLink.view")} title={t("templateLink.view")}
                  className="rounded p-1 text-ink-secondary hover:bg-hover hover:text-ink">
                  <ExternalLink size={13} />
                </button>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 flex-1 truncate text-ink-tertiary">
                  {link.name} · {new Date(link.updatedAt ?? link.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  {link.updatedAt ? ` · ${t("templateLink.updatedLabel")}` : ""}
                </span>
                <button type="button" data-template-link-update disabled={busy} onClick={() => void update(link.id)} title={t("templateLink.updateHint")}
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-ink-secondary hover:bg-hover hover:text-ink disabled:opacity-40">
                  <RefreshCw size={13} aria-hidden="true" />{t("templateLink.update")}
                </button>
                <button type="button" data-template-link-revoke disabled={busy} onClick={() => void revoke(link.id)}
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-danger hover:bg-danger/10 disabled:opacity-40">
                  <Link2Off size={13} aria-hidden="true" />{t("templateLink.revoke")}
                </button>
              </div>
              {updated === link.id && <p role="status" className="mt-1 text-success">{t("templateLink.updated")}</p>}
              {!link.reachable && <p className="mt-1 text-warning">{t("templateLink.localOnly")}</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-tertiary">{t("templateLink.never")}</p>
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </section>
  );
}
