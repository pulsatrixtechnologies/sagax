// Small pieces the three Plugins views share: the icon, the status word and
// the page header with its back arrow.
import { useState, type ReactNode } from "react";
import { BookOpen, Puzzle, ServerCog } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { WHOP_KEY, type PluginItem, type PluginStatus } from "@/lib/plugins-model";
import { Breadcrumb, type Crumb } from "../Breadcrumb";
import { WhopIcon } from "../WhopIcon";

/** A connectable app's catalog card, as the Connect apps views read it. */
export interface ToolkitCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  noAuth?: boolean;
  domain: string | null;
  categories?: string[];
}

/** A toolkit's mark: official logo, else favicon by domain, else monogram. */
export function ServiceIcon({ card, className = "size-11" }: { card: Pick<ToolkitCard, "logo" | "domain" | "label">; className?: string }) {
  // 0 = official logo, 1 = favicon by domain, 2 = monogram
  const [stage, setStage] = useState(card.logo ? 0 : card.domain ? 1 : 2);
  if (stage === 0 && card.logo) {
    return (
      <img
        src={card.logo}
        alt=""
        loading="lazy"
        className={cn("rounded-xl object-contain", className)}
        onError={() => setStage(1)}
      />
    );
  }
  if (stage === 1 && card.domain) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${card.domain}&sz=64`}
        alt=""
        loading="lazy"
        className={cn("rounded-xl object-contain", className)}
        onError={() => setStage(2)}
      />
    );
  }
  return (
    <div className={cn("flex items-center justify-center rounded-xl bg-raised text-[15px] font-semibold text-ink-secondary", className)}>
      {card.label.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function PluginIcon({ item, className = "size-10" }: { item: Pick<PluginItem, "kind" | "name" | "logo" | "domain"> & { key?: string }; className?: string }) {
  if (item.key === WHOP_KEY) {
    return <WhopIcon className={className} />;
  }
  if (item.kind === "skill") {
    return (
      <div className={cn("flex shrink-0 items-center justify-center rounded-xl bg-raised text-ink-secondary", className)}>
        <BookOpen size={18} aria-hidden="true" />
      </div>
    );
  }
  // a plugin with a real mark (its declared icon, its site, the app it is
  // named for: pluginMark) shows it as an app does; the puzzle is the last resort
  if (item.kind === "plugin" && !item.logo && !item.domain) {
    return (
      <div className={cn("flex shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-text", className)}>
        <Puzzle size={18} aria-hidden="true" />
      </div>
    );
  }
  if (item.kind === "mcp" && !item.domain && !item.logo) {
    return (
      <div className={cn("flex shrink-0 items-center justify-center rounded-xl bg-raised text-ink-secondary", className)}>
        <ServerCog size={18} aria-hidden="true" />
      </div>
    );
  }
  return <ServiceIcon key={item.logo ?? item.domain ?? ""} card={{ logo: item.logo ?? null, domain: item.domain ?? null, label: item.name }} className={cn("shrink-0", className)} />;
}

const STATUS_KEY: Record<PluginStatus, LocaleKey> = {
  connected: "connectApps.status.connected",
  needs_auth: "connectApps.status.needsAuth",
  pending: "connectApps.status.pending",
  off: "connectApps.status.off",
  available: "connectApps.status.available",
};

export function PluginStatusLabel({ status, className }: { status: PluginStatus; className?: string }) {
  return (
    <span
      data-plugin-status={status}
      className={cn(
        "shrink-0 text-[12px] font-medium",
        status === "connected" ? "text-success" : status === "needs_auth" || status === "pending" ? "text-warning" : "text-ink-secondary",
        className,
      )}
    >
      {t(STATUS_KEY[status])}
    </span>
  );
}

/** The back row of a page opened from a Connect apps tab (2026-10-28), as a
 * Settings sub-page's: the back button, the tab it came from and the pages
 * between, then this page's name. Connect Apps' own title, scope and tabs
 * stay above it, so the page reads as part of the same window and its name
 * is never a second big title. A page that names itself in its own header
 * (a plugin's detail) leaves the name out here (`named`). */
export function PluginPageHeader({ title, trail, onBack, named = false }: {
  title: string;
  /** the tab it came from, then the pages above this one (absent: Connect apps) */
  trail?: readonly Crumb[];
  onBack: () => void;
  /** the page shows its name itself: no current crumb */
  named?: boolean;
}) {
  const crumbs = trail ?? [{ label: t("connectApps.title"), onSelect: onBack }];
  return (
    <div className="shrink-0 px-4 pt-3 sm:px-8" data-plugins-page-bar>
      <Breadcrumb trail={crumbs} current={named ? undefined : title} onBack={onBack} backData={{ "data-plugins-back": "" }} />
      <h3 className="sr-only" data-plugins-page-title>{title}</h3>
    </div>
  );
}

/** One card of the detail page: a title and flat content (one card level). */
export function PluginCard({ title, children, action }: { title?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card px-4 py-3.5 sm:px-5">
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between gap-3">
          {title && <h3 className="min-w-0 text-[13px] font-semibold text-ink">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
