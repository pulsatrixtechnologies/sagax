// Small pieces the three Plugins views share: the icon, the status word and
// the page header with its back arrow.
import { useState, type ReactNode } from "react";
import { BookOpen, Boxes, Check, ChevronLeft, Plug, Puzzle, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { WHOP_KEY, type PluginItem, type PluginStatus } from "@/lib/plugins-model";
import type { Crumb } from "../Breadcrumb";
import { WhopIcon } from "../WhopIcon";
import { builtinGlyph } from "@/lib/builtin-icons";

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
export function ServiceIcon({ card, className = "size-11", glyph, faviconSize = 64 }: { /** the favicon source size: a banner asks for the largest, so it stays crisp */ faviconSize?: number; card: Pick<ToolkitCard, "logo" | "domain" | "label">; className?: string; /** what a built-in item shows when its site mark is missing or cannot load */ glyph?: LucideIcon }) {
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
        src={`https://www.google.com/s2/favicons?domain=${card.domain}&sz=${faviconSize}`}
        alt=""
        loading="lazy"
        className={cn("rounded-xl object-contain", className)}
        onError={() => setStage(2)}
      />
    );
  }
  return glyph ? <GlyphTile glyph={glyph} className={className} /> : <NeutralTile className={className} />;
}

/** An image the console serves by its https address: crisp at any size, and
 * the one neutral tile when it cannot load. */
export function RemoteImage({ src, kind = "connector", className }: { src: string; kind?: NeutralKind; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <NeutralTile kind={kind} className={className} />;
  return <img src={src} alt="" loading="lazy" data-remote-image="" onError={() => setFailed(true)} className={cn("shrink-0 object-contain", className)} />;
}

/** An item with no mark at all (#4503: no letter tiles): ONE neutral tile, the app's quiet surface with a
 * grey generic glyph, identical for every item of a kind. */
export type NeutralKind = "connector" | "skill" | "plugin" | "vendor";
const NEUTRAL_GLYPH: Record<NeutralKind, LucideIcon> = { connector: Plug, skill: BookOpen, plugin: Puzzle, vendor: Boxes };
export function NeutralTile({ kind = "connector", className = "size-10" }: { kind?: NeutralKind; className?: string }) {
  const Glyph = NEUTRAL_GLYPH[kind];
  return (
    <div data-neutral-tile={kind} aria-hidden="true" className={cn("flex shrink-0 items-center justify-center rounded-[10px] bg-raised text-ink-secondary", className)}>
      <Glyph size={18} strokeWidth={1.75} aria-hidden="true" />
    </div>
  );
}

/** A shipped glyph on the quiet tile (a built-in item with no site mark). */
export function GlyphTile({ glyph: Glyph, className = "size-10" }: { glyph: LucideIcon; className?: string }) {
  return (
    <div data-glyph-tile="" className={cn("flex shrink-0 items-center justify-center rounded-xl bg-raised text-ink-secondary", className)}>
      <Glyph size={20} strokeWidth={1.75} aria-hidden="true" />
    </div>
  );
}

export function PluginIcon({ item, className = "size-10", faviconSize }: { faviconSize?: number; item: Pick<PluginItem, "kind" | "name" | "logo" | "domain"> & { key?: string }; className?: string }) {
  if (item.key === WHOP_KEY) {
    return <WhopIcon className={className} />;
  }
  const glyph = builtinGlyph(item);
  if (item.kind === "skill") {
    return glyph ? <GlyphTile glyph={glyph} className={className} /> : (
      <div className={cn("flex shrink-0 items-center justify-center rounded-xl bg-raised text-ink-secondary", className)}>
        <BookOpen size={18} aria-hidden="true" />
      </div>
    );
  }
  // a plugin with a real mark (its declared icon, its site, the app it is
  // named for: pluginMark) shows it as an app does; the puzzle is the last resort
  if (item.kind === "plugin" && !item.logo && !item.domain) {
    if (glyph) return <GlyphTile glyph={glyph} className={className} />;
    return (
      <div className={cn("flex shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-text", className)}>
        <Puzzle size={18} aria-hidden="true" />
      </div>
    );
  }
  if (item.kind === "mcp" && !item.domain && !item.logo) {
    // a shipped glyph when the app has one for it, else the one neutral tile (never the same generic glyph on every server)
    return glyph ? <GlyphTile glyph={glyph} className={className} /> : <NeutralTile className={className} />;
  }
  return <ServiceIcon key={item.logo ?? item.domain ?? ""} card={{ logo: item.logo ?? null, domain: item.domain ?? null, label: item.name }} glyph={glyph} faviconSize={faviconSize} className={cn("shrink-0", className)} />;
}

const STATUS_KEY: Record<PluginStatus, LocaleKey> = {
  connected: "connectApps.status.connected",
  needs_auth: "connectApps.status.needsAuth",
  pending: "connectApps.status.pending",
  off: "connectApps.status.off",
  available: "connectApps.status.available",
};

/** "✓ Installed" at a row's right, in the reference's "Connected" shape
 * (#4097, measured): a 12px green check, then 12px words in the tertiary ink,
 * 5px apart. Installed rows pass "Connected" with their own status. */
export function ConnectedMark({ label, status = "installed" }: { label?: string; status?: string } = {}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-[5px] py-0.5 text-[12px] leading-4 whitespace-nowrap text-ink-tertiary" data-plugin-status={status}>
      <Check size={12} strokeWidth={2.5} className="text-success" aria-hidden="true" />
      {label ?? t("connectApps.status.installed")}
    </span>
  );
}

export function PluginStatusLabel({ status, className }: { status: PluginStatus; className?: string }) {
  // connected: the reference's "Connected" shape, the one way every row says it (#4097)
  if (status === "connected") return <ConnectedMark status="connected" label={t(STATUS_KEY.connected)} />;
  return (
    <span
      data-plugin-status={status}
      className={cn(
        "shrink-0 text-[12px] font-medium",
        status === "needs_auth" || status === "pending" ? "text-warning" : "text-ink-secondary",
        className,
      )}
    >
      {t(STATUS_KEY[status])}
    </span>
  );
}

/** The top bar of a page opened in the Plugins window (#2104, Grok Bot's
 * Connect Apps): the back chevron on the left, room for the window's X on the
 * right, a hairline under it. A page that draws its own name (`named`: a
 * plugin, a bundle, a skill, a connector) shows no title here: the bar is a
 * back link that names where the person came from ("< Skills"), so the name is
 * read once, in the page's header. Any other page keeps its name centred. The
 * pages above stay on the button's tooltip (progressive disclosure). */
export function PluginPageHeader({ title, trail, onBack, named = false }: {
  title: string;
  /** the view it came from, then the pages above this one (absent: Connect apps) */
  trail?: readonly Crumb[];
  onBack: () => void;
  /** the page draws its own name: the bar is only the back link, naming the view it came from */
  named?: boolean;
}) {
  const crumbs = trail ?? [{ label: t("connectApps.title"), onSelect: onBack }];
  const from = crumbs[crumbs.length - 1]?.label;
  return (
    // The row's centre line is the window close button's (CATEGORY_MODAL.close: top 10px, 32px tall, centre 26px):
    // a named bar sits its 32px link 10px down (pt-2.5), a titled bar is 52px tall and centres. A named bar's
    // link glyph starts on the page's own left edge (px-4, sm:px-[34px], as the header below); the hover pill leans left of it.
    <div className={cn("relative flex shrink-0 pr-14", named ? "items-start px-4 pb-1 pt-2.5 sm:px-[34px]" : "h-[52px] items-center px-3")} data-plugins-page-bar data-breadcrumb="">
      <button
        type="button"
        onClick={onBack}
        aria-label={from ? t("connectApps.backTo", { name: from }) : t("breadcrumb.back")}
        title={crumbs.map((crumb) => crumb.label).join(" / ")}
        className={cn("flex h-8 shrink-0 items-center gap-1 rounded-full text-ink hover:bg-hover", named && from ? "-ml-3.5 min-w-0 max-w-[60%] pl-1.5 pr-3 text-[13px] leading-5" : "w-8 justify-center")}
        data-breadcrumb-back=""
        data-plugins-back=""
      >
        <ChevronLeft size={20} aria-hidden="true" className="shrink-0" />
        {named && from && <span className="truncate" data-plugins-back-label="">{from}</span>}
      </button>
      {!named && <h3 className="pointer-events-none absolute inset-x-14 truncate text-center text-[14px] font-normal leading-5 text-ink" data-plugins-page-title>{title}</h3>}
    </div>
  );
}

/** One card of a page (#2104): a gray label over a card with a subtle
 * border on the window's own background. The label sits on the card's own left
 * edge, which is the page's (the header, the tabs and the cards share one
 * edge); a section's actions sit at the label's right. */
export function PluginCard({ title, children, action }: { title?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section>
      {(title || action) && (
        <div className="mb-2 flex min-h-[26px] flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {title && <h3 className="min-w-0 text-[13px] font-normal leading-5 text-ink-secondary">{title}</h3>}
          {action && <div className="ml-auto flex flex-wrap items-center gap-2">{action}</div>}
        </div>
      )}
      <div className="rounded-[14px] border-[0.5px] border-ink/10 px-[14px] py-2">{children}</div>
    </section>
  );
}
