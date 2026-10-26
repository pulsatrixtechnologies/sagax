// Plugins > Manage > Marketplaces: add a Claude Code plugin marketplace by
// GitHub repository (owner/repo, with an optional branch), by https git
// address or by the address of its marketplace.json; fetch it again or
// remove it. One list for both install scopes: each marketplace becomes a
// chip and a section of Connect apps, for everyone and for each bot.
//
// With `tokens`, each marketplace has a token field (server/marketplace-
// tokens.ts): in the bot scope for that bot (kept per bot and source), in
// the "Everyone" scope for the whole installation (kept under `workspace`,
// an admin only, so a private marketplace works for everyone). A private
// repository is read with that token first, then the person's GitHub
// connection, then the organization's GitHub tokens. When the git host
// refuses an add or a refresh, the parent says so (`needsToken`) and the
// field opens there.
import { useEffect, useState, type ReactNode } from "react";
import { KeyRound, Loader2, Lock, Plus, RefreshCw, Store, Trash2, Users } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export type MarketplaceVisibility = "private" | "org";

export interface MarketplaceSummary {
  name: string;
  source: string;
  ref?: string;
  description?: string;
  plugins: Array<{ name: string; installed: boolean }>;
  /** bots with a plugin of this marketplace installed */
  bots?: number;
  /** the bot scope's bot keeps a token for it (never the token) */
  hasToken?: boolean;
  /** "private" (the person who added it) or "org" (shared with everyone) */
  visibility?: MarketplaceVisibility;
  /** this viewer added it, so may change its visibility */
  mine?: boolean;
}

/** Private (me) vs Organisation (everyone): two pills, like the scope toggle. */
function VisibilityChoice({ value, onChange, disabled }: { value: MarketplaceVisibility; onChange: (value: MarketplaceVisibility) => void; disabled?: boolean }) {
  const option = (choice: MarketplaceVisibility, label: string, icon: ReactNode) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === choice}
      disabled={disabled}
      data-marketplace-visibility-option={choice}
      onClick={() => onChange(choice)}
      className={cn(
        "flex h-7 min-w-0 items-center gap-1.5 rounded-full px-3 text-[12px] transition-colors disabled:opacity-40",
        value === choice ? "bg-accent text-accent-ink" : "text-ink-secondary hover:bg-hover hover:text-ink",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
  return (
    <div role="radiogroup" aria-label={t("connectApps.market.visibility.aria")} data-marketplace-visibility={value}
      className="flex w-fit max-w-full items-center gap-0.5 rounded-full border border-border p-0.5">
      {option("private", t("connectApps.market.visibility.private"), <Lock size={12} aria-hidden="true" />)}
      {option("org", t("connectApps.market.visibility.org"), <Users size={12} aria-hidden="true" />)}
    </div>
  );
}

/** The scope badge shown on each row. Clickable for a marketplace the viewer
 * owns when `onToggle` is given; a plain pill otherwise. */
function VisibilityBadge({ visibility, onToggle, disabled }: { visibility: MarketplaceVisibility; onToggle?: () => void; disabled?: boolean }) {
  const isOrg = visibility === "org";
  const label = isOrg ? t("connectApps.market.visibility.orgBadge") : t("connectApps.market.visibility.privateBadge");
  const icon = isOrg ? <Users size={11} aria-hidden="true" /> : <Lock size={11} aria-hidden="true" />;
  const className = cn(
    "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
    isOrg ? "bg-accent/15 text-accent" : "bg-hover text-ink-secondary",
  );
  if (!onToggle) return <span className={className} data-marketplace-scope={visibility}>{icon}{label}</span>;
  return (
    <button type="button" disabled={disabled} onClick={onToggle} data-marketplace-scope={visibility}
      className={cn(className, "transition-colors hover:text-ink disabled:opacity-40")}
      title={isOrg ? t("connectApps.market.visibility.makePrivate") : t("connectApps.market.visibility.makeOrg")}>
      {icon}{label}
    </button>
  );
}

/** The token per marketplace: this bot's (bot scope) or everyone's (an
 * admin in the "Everyone" scope). */
export interface MarketplaceTokenControls {
  /** whose token it is: the hint says so (default "bot") */
  scope?: "bot" | "workspace";
  /** save (or replace) the token, then fetch the marketplace again */
  onSave: (name: string, token: string) => Promise<boolean>;
  onRemove: (name: string) => Promise<boolean>;
}

export function MarketplacesSection({ marketplaces, busy, error, onAdd, onRefresh, onRemove, onSetVisibility, canChooseVisibility, disabled, removeKeepsInstalls, tokens, needsToken }: {
  marketplaces: MarketplaceSummary[] | null;
  /** "add", or the name being refreshed or removed */
  busy: string | null;
  error: string | null;
  /** `visibility`: who sees it (default private); `token`: tried first and kept */
  onAdd: (source: string, ref: string, visibility: MarketplaceVisibility, token?: string) => Promise<boolean>;
  onRefresh: (name: string) => void;
  onRemove: (name: string) => void;
  /** change a marketplace's visibility (shown on rows the viewer owns) */
  onSetVisibility?: (name: string, visibility: MarketplaceVisibility) => void;
  /** show the Private/Organisation choice on the add form */
  canChooseVisibility?: boolean;
  disabled?: boolean;
  /** removing from one bot takes its plugins with it: installs never block */
  removeKeepsInstalls?: boolean;
  /** a token field per marketplace, kept for that bot or for everyone */
  tokens?: MarketplaceTokenControls;
  /** the git host refused: "add" offers a token for the source being
   * added, a name opens that marketplace's token field */
  needsToken?: string | null;
}) {
  const [source, setSource] = useState("");
  const [ref, setRef] = useState("");
  const [visibility, setVisibility] = useState<MarketplaceVisibility>("private");
  const [token, setToken] = useState("");
  /** the marketplace whose token field is open, or "add" */
  const [tokenFor, setTokenFor] = useState<string | null>(tokens && needsToken ? needsToken : null);
  useEffect(() => {
    if (tokens && needsToken) {
      setToken("");
      setTokenFor(needsToken);
    }
  }, [tokens, needsToken]);
  const forEveryone = tokens?.scope === "workspace";
  const tokenHint = forEveryone ? t("plugins.tokenHintWorkspace") : t("plugins.tokenHint");
  const tokenForm = (label: string, id: string, onSubmit: (value: string) => void) => (
    <form className="flex flex-wrap items-center gap-2" data-marketplace-token-form={id} onSubmit={(event) => { event.preventDefault(); if (token.trim().length >= 8) onSubmit(token.trim()); }}>
      <input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder={t("plugins.tokenPlaceholder")} aria-label={label}
        className="min-w-0 flex-[1_1_220px] rounded-lg border border-border bg-raised px-3 py-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-secondary focus:border-accent" />
      <button type="submit" disabled={disabled || busy !== null || token.trim().length < 8} className="rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-accent-ink disabled:opacity-40">{label}</button>
    </form>
  );
  return (
    <section className="mt-6" data-plugins-marketplaces>
      <h3 className="mb-1 text-[13px] font-semibold text-ink">{t("connectApps.market.title")}</h3>
      <p className="mb-2 text-[12px] leading-relaxed text-ink-secondary">{t("connectApps.market.intro")} {t("connectApps.market.introScopes")}</p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!source.trim()) return;
          void onAdd(source.trim(), ref.trim(), visibility).then((ok) => {
            if (ok) {
              setSource("");
              setRef("");
              setVisibility("private");
            }
          });
        }}
      >
        <input
          value={source}
          onChange={(event) => { setSource(event.target.value); if (tokenFor === "add") setTokenFor(null); }}
          placeholder={t("connectApps.market.sourcePlaceholder")}
          aria-label={t("connectApps.market.sourceAria")}
          spellCheck={false}
          className="min-w-0 flex-[1_1_260px] rounded-lg border border-border bg-raised px-3 py-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-secondary focus:border-accent"
        />
        <input
          value={ref}
          onChange={(event) => setRef(event.target.value)}
          placeholder={t("connectApps.market.refPlaceholder")}
          aria-label={t("connectApps.market.refPlaceholder")}
          spellCheck={false}
          className="w-[130px] rounded-lg border border-border bg-raised px-3 py-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-secondary focus:border-accent"
        />
        <button type="submit" disabled={disabled || busy !== null || !source.trim()} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-accent-ink disabled:opacity-40">
          {busy === "add" ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {t("connectApps.market.add")}
        </button>
      </form>
      {canChooseVisibility && (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-marketplace-add-visibility="">
          <span className="text-[12px] text-ink-secondary">{t("connectApps.market.visibility.label")}</span>
          <VisibilityChoice value={visibility} onChange={setVisibility} disabled={disabled || busy !== null} />
          <span className="text-[11.5px] text-ink-secondary">{visibility === "org" ? t("connectApps.market.visibility.orgHint") : t("connectApps.market.visibility.privateHint")}</span>
        </div>
      )}
      {tokens && tokenFor === "add" && source.trim() && (
        <div className="mt-2 flex flex-col gap-1.5 rounded-lg bg-inset px-3 py-2" data-marketplace-add-token="">
          <p className="text-[12px] text-ink-secondary">{forEveryone ? t("plugins.tokenOfferWorkspace") : t("plugins.tokenOffer")}</p>
          {tokenForm(t("plugins.addWithToken"), "add", (value) => {
            void onAdd(source.trim(), ref.trim(), visibility, value).then((ok) => {
              if (ok) {
                setSource("");
                setRef("");
                setVisibility("private");
                setToken("");
                setTokenFor(null);
              }
            });
          })}
          <p className="text-[11.5px] text-ink-secondary">{tokenHint}</p>
        </div>
      )}
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>}
      {marketplaces && marketplaces.length > 0 && (
        <ul className="mt-3 divide-y divide-hairline/60 rounded-2xl border border-border bg-card">
          {marketplaces.map((market) => {
            const installed = market.plugins.filter((plugin) => plugin.installed).length;
            const bots = market.bots ?? 0;
            const blocked = removeKeepsInstalls ? null
              : installed > 0 ? t("connectApps.market.removeBlocked")
                : bots > 0 ? t("connectApps.market.removeBlockedBots", { count: bots })
                  : null;
            return (
              <li key={market.name} data-marketplace={market.name} className="px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <Store size={16} className="shrink-0 text-ink-secondary" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-ink">{market.name}</div>
                    <div className="truncate text-[11.5px] text-ink-secondary">
                      <span className="font-mono">{market.source}{market.ref ? `#${market.ref}` : ""}</span>
                      {" · "}{t("connectApps.market.pluginCount", { count: market.plugins.length, installed })}
                    </div>
                  </div>
                  {market.visibility && (
                    <VisibilityBadge
                      visibility={market.visibility}
                      disabled={disabled || busy !== null}
                      {...(onSetVisibility && market.mine ? { onToggle: () => onSetVisibility(market.name, market.visibility === "org" ? "private" : "org") } : {})}
                    />
                  )}
                  {tokens && market.hasToken && <span className="rounded-full bg-hover px-2 py-0.5 text-[11px] text-ink-secondary" data-marketplace-has-token="">{t("plugins.tokenSaved")}</span>}
                  {tokens && (
                    <button type="button" disabled={disabled || busy !== null} data-marketplace-token-open={market.name}
                      onClick={() => { setToken(""); setTokenFor(tokenFor === market.name ? null : market.name); }}
                      className="ui-icon-button disabled:opacity-40" aria-label={`${t("plugins.token")}: ${market.name}`} title={t("plugins.token")}>
                      <KeyRound size={14} />
                    </button>
                  )}
                  <button type="button" disabled={disabled || busy !== null} onClick={() => onRefresh(market.name)} className="ui-icon-button disabled:opacity-40"
                    aria-label={t("connectApps.market.refreshAria", { name: market.name })} title={t("connectApps.market.refreshAria", { name: market.name })}>
                    <RefreshCw size={14} className={busy === `refresh:${market.name}` ? "animate-spin" : undefined} />
                  </button>
                  <button type="button" disabled={disabled || busy !== null || blocked !== null} onClick={() => onRemove(market.name)}
                    data-marketplace-remove={market.name}
                    className="rounded-md p-1.5 text-ink-secondary hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                    aria-label={t("connectApps.market.removeAria", { name: market.name })}
                    title={blocked ?? t("connectApps.market.removeAria", { name: market.name })}>
                    <Trash2 size={14} />
                  </button>
                </div>
                {tokens && tokenFor === market.name && (
                  <div className="mt-2 flex flex-col gap-1.5 border-t border-hairline/60 pt-2" data-marketplace-token={market.name}>
                    <p className="text-[11.5px] text-ink-secondary">{tokenHint}</p>
                    {tokenForm(market.hasToken ? t("plugins.tokenReplace") : t("plugins.tokenSave"), market.name, (value) => {
                      void tokens.onSave(market.name, value).then((ok) => {
                        if (ok) {
                          setToken("");
                          setTokenFor(null);
                        }
                      });
                    })}
                    {market.hasToken && (
                      <button type="button" className="self-start text-[12px] text-ink-secondary underline disabled:opacity-40" disabled={disabled || busy !== null}
                        onClick={() => void tokens.onRemove(market.name).then((ok) => { if (ok) setTokenFor(null); })}>
                        {t("plugins.tokenRemove")}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
