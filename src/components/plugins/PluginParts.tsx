// Small pieces the three Plugins views share: the icon, the status word and
// the page header with its back arrow.
import { useState, type ReactNode } from "react";
import { BookOpen, ChevronLeft, Puzzle, ServerCog } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { WHOP_KEY, type PluginItem, type PluginStatus } from "@/lib/plugins-model";
import type { Crumb } from "../Breadcrumb";
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

/** The top bar of a page opened in the Plugins window (#2104, Grok Bot's
 * Connect Apps): the back chevron on the left, the page's name centred, room
 * for the window's X on the right, a hairline under it. The pages it came
 * from stay on the back button's tooltip (progressive disclosure). */
export function PluginPageHeader({ title, trail, onBack }: {
  title: string;
  /** the view it came from, then the pages above this one (absent: Connect apps) */
  trail?: readonly Crumb[];
  onBack: () => void;
  /** kept for the callers: the name is always in the bar now */
  named?: boolean;
}) {
  const crumbs = trail ?? [{ label: t("connectApps.title"), onSelect: onBack }];
  const from = crumbs[crumbs.length - 1]?.label;
  return (
    <div className="relative flex h-12 shrink-0 items-center px-3 pr-14" data-plugins-page-bar data-breadcrumb="">
      <button
        type="button"
        onClick={onBack}
        aria-label={from ? t("connectApps.backTo", { name: from }) : t("breadcrumb.back")}
        title={crumbs.map((crumb) => crumb.label).join(" / ")}
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink hover:bg-hover"
        data-breadcrumb-back=""
        data-plugins-back=""
      >
        <ChevronLeft size={20} aria-hidden="true" />
      </button>
      <h3 className="pointer-events-none absolute inset-x-14 truncate text-center text-[14px] font-normal leading-5 text-ink" data-plugins-page-title>{title}</h3>
    </div>
  );
}

/** One card of a page (#2104): a gray label over a card with a subtle
 * border on the window's own background. */
export function PluginCard({ title, children, action }: { title?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section>
      {(title || action) && (
        <div className="mb-2.5 flex items-center justify-between gap-3 px-[14px]">
          {title && <h3 className="min-w-0 text-[12.5px] font-normal leading-5 text-ink-secondary">{title}</h3>}
          {action}
        </div>
      )}
      <div className="rounded-[14px] border-[0.5px] border-ink/10 px-[14px] py-2">{children}</div>
    </section>
  );
}
