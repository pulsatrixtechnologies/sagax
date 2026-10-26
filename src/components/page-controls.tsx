// The controls a published page's card, its Settings row and its full-page
// viewer share (src/components/PublishedPages.tsx, PageViewer.tsx): who can
// see it, its expiry, its link, the organization's switch for public links.
import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Globe, Lock, Users } from "lucide-react";

import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { api, ApiError } from "@/state/store";
import {
  DEFAULT_PAGES_POLICY,
  PAGE_ACCESS,
  PAGE_EXPIRY_CHOICES,
  type PageAccess,
  type PagesPolicy,
  type PublishedPageSummary,
} from "../../shared/published-pages";

export const ACCESS_LABEL: Record<PageAccess, LocaleKey> = {
  private: "pages.access.private",
  org: "pages.access.org",
  link: "pages.access.link",
};
const ACCESS_HINT: Record<PageAccess, LocaleKey> = {
  private: "pages.access.privateHint",
  org: "pages.access.orgHint",
  link: "pages.access.linkHint",
};
const ACCESS_ICON = { private: Lock, org: Users, link: Globe } as const;

/** The expiry a choice of hours stands for (0: never). Pure. */
export function expiryFromHours(hours: number, now = Date.now()): number | null {
  return hours > 0 ? now + hours * 60 * 60 * 1000 : null;
}

function expiryLabel(hours: number): string {
  if (hours === 0) return t("pages.expiry.never");
  if (hours === 24) return t("pages.expiry.day");
  if (hours === 7 * 24) return t("pages.expiry.week");
  return t("pages.expiry.month");
}

export function when(at: number): string {
  return new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function openPage(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Only this server's own preview wrapper path is ever framed, with the
 * annotation flag at most. Pure. */
export function previewSrc(path: string, options: { annotate?: boolean } = {}): string | null {
  if (!/^\/pages\/preview\/[A-Za-z0-9_-]{8,40}\/\d{1,4}$/.test(path)) return null;
  return options.annotate ? `${path}?annotate=1` : path;
}

/** Switching a page to "anyone with the link" asks the same second press as
 * a first publish. Pure. */
export function needsLinkConfirm(current: PageAccess, next: PageAccess): boolean {
  return next === "link" && current !== "link";
}

/** A refusal in words: a closed public-link switch proposes My organization. */
export function pageErrorText(cause: unknown): string {
  if (cause instanceof ApiError && cause.body?.code === "link_sharing_off") return t("pages.linkOffError");
  return cause instanceof Error ? cause.message : String(cause);
}

/** The organization's switch for public links, as this person reads it. */
export function usePagesPolicy(): PagesPolicy {
  const [policy, setPolicy] = useState<PagesPolicy>(DEFAULT_PAGES_POLICY);
  useEffect(() => {
    let live = true;
    api<PagesPolicy>("/api/pages/policy")
      .then((answer) => { if (live && typeof answer?.linkSharing === "boolean") setPolicy({ ...DEFAULT_PAGES_POLICY, ...answer }); })
      .catch(() => { /* an older server: no switch, links allowed */ });
    return () => { live = false; };
  }, []);
  return policy;
}

export function AccessPicker({ value, onChange, name, disabled, linkOff }: {
  value: PageAccess;
  onChange(access: PageAccess): void;
  name: string;
  disabled?: boolean;
  /** The organization turned public links off. */
  linkOff?: boolean;
}) {
  return (
    <fieldset className="space-y-1" disabled={disabled}>
      <legend className="mb-1 text-[12px] font-medium text-ink">{t("pages.whoCanSee")}</legend>
      {PAGE_ACCESS.map((access) => {
        const Icon = ACCESS_ICON[access];
        const off = access === "link" && linkOff === true;
        return (
          <label key={access} className={`flex items-start gap-2 rounded-md px-1.5 py-1 text-[12.5px] ${off ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-raised/50"}`}>
            <input type="radio" name={name} value={access} checked={value === access} disabled={off} onChange={() => onChange(access)} className="mt-0.5" />
            <Icon size={13} aria-hidden="true" className="mt-0.5 text-ink-secondary" />
            <span>
              <span className="text-ink">{t(ACCESS_LABEL[access])}</span>
              <span className="block text-[11.5px] text-ink-tertiary">{off ? t("pages.linkOff") : t(ACCESS_HINT[access])}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function ExpirySelect({ value, onChange, disabled }: { value: number; onChange(hours: number): void; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-ink">
      {t("pages.expiry.label")}
      <select value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))}
        className="rounded-md border border-hairline/50 bg-panel px-2 py-1 text-[12.5px]">
        {value < 0 && <option value={-1} disabled>{t("pages.expiry.change")}</option>}
        {PAGE_EXPIRY_CHOICES.map((hours) => <option key={hours} value={hours}>{expiryLabel(hours)}</option>)}
      </select>
    </label>
  );
}

export function LinkRow({ page }: { page: PublishedPageSummary }) {
  const [copied, setCopied] = useState(false);
  if (!page.url) return null;
  const label = page.access === "link" ? t("pages.copyPublicLink") : t("pages.copyLink");
  return (
    <div className="flex items-center gap-2 rounded-lg bg-raised/45 px-2.5 py-1.5 text-[12px]">
      <span className="min-w-0 flex-1 truncate text-ink" title={page.url}>{page.url}</span>
      <button type="button" aria-label={label} title={label} onClick={() => void copyText(page.url!).then((result) => setCopied(result === "copied"))}
        className="rounded p-1 text-ink-secondary hover:bg-hover hover:text-ink">
        {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
      </button>
      <button type="button" aria-label={t("pages.open")} title={t("pages.open")} onClick={() => openPage(page.url!)}
        className="rounded p-1 text-ink-secondary hover:bg-hover hover:text-ink">
        <ExternalLink size={13} />
      </button>
      {page.reachable === false && <span className="text-warning">{t("pages.localOnly")}</span>}
    </div>
  );
}
