// Plugins > Manage > Marketplaces: add a Claude Code plugin marketplace by
// GitHub repository (owner/repo, with an optional branch), by https git
// address or by the address of its marketplace.json; fetch it again or
// remove it. One list for both install scopes: each marketplace becomes a
// chip and a section of Connect apps, for everyone and for each bot.
//
// With `credentials` (2026-10-28), a marketplace reads with the person's
// GitHub account (the GitHub plugin's page) by default ("Automatic") and says
// which credential read it last. Only when the person has other credentials
// beside that account (server/github/github-credentials.ts) does each row offer a
// small selector to pick one; there is no token field here. In the bot scope
// the pick is that bot's (its owner or a manager), in the "Everyone" scope
// the installation's. When the git host refuses an add or a refresh, the
// parent says so (`needsToken`): the pick opens there, or a link to My
// accounts > GitHub when there is nothing to pick.
import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, Check, Loader2, Lock, Plus, RefreshCw, Store, Trash2, Users } from "lucide-react";

import { cn } from "@/lib/cn";
import { credentialOptions, useGithubCredentials, type MarketplaceCredentialView } from "@/lib/github-credentials";
import { t } from "@/lib/i18n";
import { OFFICIAL_CATALOGS } from "../../../shared/skill-catalogs";

export type MarketplaceVisibility = "private" | "org";

export interface MarketplaceSummary {
  name: string;
  source: string;
  ref?: string;
  description?: string;
  plugins: Array<{ name: string; installed: boolean }>;
  /** bots with a plugin of this marketplace installed */
  bots?: number;
  /** the scope picks a credential for it (never the token) */
  hasToken?: boolean;
  /** the credential it picks (absent: Automatic) and the one that read it last */
  credential?: MarketplaceCredentialView;
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

/** Each marketplace's pick of a credential: this bot's (bot scope) or
 * everyone's (the "Everyone" scope). */
export interface MarketplaceCredentialControls {
  /** whose pick it is: the hint says so (default "bot") */
  scope?: "bot" | "me" | "workspace";
  /** pick a credential (null: Automatic), then fetch the marketplace again */
  onChoose: (name: string, credential: string | null) => Promise<boolean>;
}

/** Which credential read a marketplace last, in words. */
export function credentialUsedText(view: MarketplaceCredentialView | undefined): string | null {
  const used = view?.used;
  if (!used) return null;
  if (used.via === "person") return used.login ? t("sources.market.usedPerson", { login: used.login }) : t("sources.market.usedPersonPlain");
  if (used.via === "credential") return used.label ? t("sources.market.usedCredential", { label: used.label }) : t("sources.market.usedCredentialPlain");
  return t("sources.market.usedNone");
}

/** The viewer has a credential to pick, or the row already picks one. */
function useHasCredentials(load: boolean): boolean {
  const { view } = useGithubCredentials(load);
  return credentialOptions(view).length > 0;
}

/** Automatic, or one credential of the list. */
function CredentialSelect({ value, chosen, onChange, disabled, label, id }: {
  value: string | null;
  chosen?: MarketplaceCredentialView["chosen"];
  onChange: (credential: string | null) => void;
  disabled?: boolean;
  label: string;
  id: string;
}) {
  const { view } = useGithubCredentials();
  const options = credentialOptions(view, chosen);
  const orgBadge = t("sources.github.orgBadge");
  const otherPerson = t("sources.market.otherPerson");
  const automatic = t("sources.market.automatic");
  const ownerText = (owner: "mine" | "org" | "other") => (owner === "org" ? ` · ${orgBadge}` : owner === "other" ? ` · ${otherPerson}` : "");
  return (
    <select value={value ?? ""} disabled={disabled} aria-label={label} data-marketplace-credential={id}
      onChange={(event) => onChange(event.target.value || null)}
      className="max-w-[220px] min-w-0 truncate rounded-lg border border-border bg-raised px-2 py-1 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-40">
      <option value="">{automatic}</option>
      {options.map((option) => (
        <option key={option.id} value={option.id} disabled={option.owner === "other"}>{option.label}{ownerText(option.owner)}</option>
      ))}
    </select>
  );
}

export function MarketplacesSection({ marketplaces, busy, error, onAdd, onRefresh, onRemove, onSetVisibility, canChooseVisibility, disabled, removeKeepsInstalls, credentials, needsToken, onOpenGithub }: {
  marketplaces: MarketplaceSummary[] | null;
  /** "add", or the name being refreshed or removed */
  busy: string | null;
  error: string | null;
  /** `visibility`: who sees it (default private); `credential`: a credential
   * of the list, tried first and picked once the clone works */
  onAdd: (source: string, ref: string, visibility: MarketplaceVisibility, credential?: string) => Promise<boolean>;
  onRefresh: (name: string) => void;
  onRemove: (name: string) => void;
  /** change a marketplace's visibility (shown on rows the viewer owns) */
  onSetVisibility?: (name: string, visibility: MarketplaceVisibility) => void;
  /** show the Private/Organisation choice on the add form */
  canChooseVisibility?: boolean;
  disabled?: boolean;
  /** removing from one bot takes its plugins with it: installs never block */
  removeKeepsInstalls?: boolean;
  /** each marketplace picks a credential of the list, for that bot or for everyone */
  credentials?: MarketplaceCredentialControls;
  /** the git host refused: "add" offers a credential for the source being
   * added, a name points at that marketplace's pick */
  needsToken?: string | null;
  /** the GitHub plugin's page: the GitHub account and the other credentials */
  onOpenGithub?: () => void;
}) {
  const [source, setSource] = useState("");
  const [ref, setRef] = useState("");
  const [visibility, setVisibility] = useState<MarketplaceVisibility>("private");
  /** the official catalog being added in one click */
  const [pendingOfficial, setPendingOfficial] = useState<string | null>(null);
  /** the credential picked for an add the git host refused */
  const [addCredential, setAddCredential] = useState<string | null>(null);
  /** "add", or the marketplace whose pick the git host asked for */
  const [needs, setNeeds] = useState<string | null>(credentials && needsToken ? needsToken : null);
  useEffect(() => {
    if (credentials && needsToken) setNeeds(needsToken);
  }, [credentials, needsToken]);
  const forEveryone = credentials?.scope === "workspace";
  const pickHint = forEveryone ? t("sources.market.pickHintWorkspace") : t("sources.market.pickHint");
  const hasCredentials = useHasCredentials(Boolean(credentials));
  const needsPick = t("sources.market.needsPick");
  const openGithub = onOpenGithub
    ? <button type="button" className="ui-button text-[12px]" data-marketplace-open-github onClick={onOpenGithub}>{t("connectApps.detail.openGithub")}</button>
    : null;
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
          onChange={(event) => { setSource(event.target.value); if (needs === "add") setNeeds(null); }}
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
      {credentials && needs === "add" && source.trim() && !hasCredentials && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-inset px-3 py-2" data-marketplace-add-token="">
          <p className="min-w-0 flex-1 text-[12px] text-ink-secondary">{t("sources.market.needsAccount")}</p>
          {openGithub}
        </div>
      )}
      {credentials && needs === "add" && source.trim() && hasCredentials && (
        <div className="mt-2 flex flex-col gap-1.5 rounded-lg bg-inset px-3 py-2" data-marketplace-add-token="">
          <p className="text-[12px] text-ink-secondary">{t("sources.market.addOffer")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <CredentialSelect id="add" value={addCredential} onChange={setAddCredential} disabled={disabled || busy !== null} label={t("sources.market.pickAria", { name: source.trim() })} />
            <button type="button" disabled={disabled || busy !== null || !addCredential} className="rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-ink disabled:opacity-40"
              onClick={() => void onAdd(source.trim(), ref.trim(), visibility, addCredential ?? undefined).then((ok) => {
                if (ok) {
                  setSource("");
                  setRef("");
                  setVisibility("private");
                  setAddCredential(null);
                  setNeeds(null);
                }
              })}>
              {t("sources.market.addWith")}
            </button>
          </div>
          <p className="text-[11.5px] text-ink-secondary">{pickHint}</p>
          {openGithub && <div>{openGithub}</div>}
        </div>
      )}
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>}
      {marketplaces && marketplaces.length > 0 && (
        <ul className="mt-3 divide-y divide-hairline/60 rounded-[14px] border-[0.5px] border-ink/10 bg-ink/[0.015]">
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
                    {credentials && credentialUsedText(market.credential) && (
                      <div className="truncate text-[11.5px] text-ink-secondary" data-marketplace-credential-used={market.credential?.used?.via}>{credentialUsedText(market.credential)}</div>
                    )}
                  </div>
                  {market.visibility && (
                    <VisibilityBadge
                      visibility={market.visibility}
                      disabled={disabled || busy !== null}
                      {...(onSetVisibility && market.mine ? { onToggle: () => onSetVisibility(market.name, market.visibility === "org" ? "private" : "org") } : {})}
                    />
                  )}
                  {credentials && (hasCredentials || market.credential?.chosen) && (
                    <CredentialSelect id={market.name} value={market.credential?.chosen?.id ?? null} chosen={market.credential?.chosen}
                      disabled={disabled || busy !== null}
                      label={t("sources.market.pickAria", { name: market.name })}
                      onChange={(credential) => void credentials.onChoose(market.name, credential).then((ok) => { if (ok && needs === market.name) setNeeds(null); })} />
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
                {credentials && needs === market.name && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-hairline/60 pt-2" data-marketplace-token={market.name}>
                    <p className="min-w-0 flex-1 text-[11.5px] text-ink-secondary">{hasCredentials || market.credential?.chosen ? `${needsPick} ${pickHint}` : t("sources.market.needsAccount")}</p>
                    {openGithub}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <OfficialCatalogs marketplaces={marketplaces ?? []} disabled={disabled || busy !== null} adding={busy === "add" ? pendingOfficial : null}
        onAdd={(catalogSource) => { setPendingOfficial(catalogSource); void onAdd(catalogSource, "", visibility).finally(() => setPendingOfficial(null)); }} />
    </section>
  );
}

function officialCatalogBlurb(id: string): string {
  switch (id) {
    case "hermes-agent": return t("connectApps.market.official.hermes");
    case "openclaw": return t("connectApps.market.official.openclaw");
    case "claude-plugins-official": return t("connectApps.market.official.claudePlugins");
    default: return t("connectApps.market.official.agentSkills");
  }
}

/** #2613: the official skill catalogs (Hermes Agent, OpenClaw, Anthropic),
 * each added in one click; one already in the list shows Added. */
function OfficialCatalogs({ marketplaces, disabled, adding, onAdd }: {
  marketplaces: MarketplaceSummary[];
  disabled?: boolean;
  adding: string | null;
  onAdd: (source: string) => void;
}) {
  const added = new Set(marketplaces.map((market) => market.source.toLowerCase()));
  return (
    <div className="mt-5" data-plugins-official-catalogs="">
      <h4 className="mb-1 text-[13px] font-semibold text-ink">{t("connectApps.market.official.title")}</h4>
      <p className="mb-2 text-[12px] leading-relaxed text-ink-secondary">{t("connectApps.market.official.intro")}</p>
      <ul className="divide-y divide-hairline/60 rounded-[14px] border-[0.5px] border-ink/10 bg-ink/[0.015]">
        {OFFICIAL_CATALOGS.map((catalog) => {
          const isAdded = added.has(catalog.source.toLowerCase());
          return (
            <li key={catalog.id} data-official-catalog={catalog.id} className="flex items-center gap-3 px-4 py-2.5">
              <BookOpen size={16} className="shrink-0 text-ink-secondary" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink">{catalog.label}</div>
                <div className="truncate text-[11.5px] text-ink-secondary">
                  <span className="font-mono">{catalog.source}</span>{" · "}{officialCatalogBlurb(catalog.id)}
                </div>
              </div>
              {isAdded ? (
                <span className="flex items-center gap-1 text-[12px] text-ink-secondary" data-official-catalog-added=""><Check size={14} aria-hidden="true" />{t("connectApps.market.official.added")}</span>
              ) : (
                <button type="button" className="ui-button flex items-center gap-1.5 text-[12px]" disabled={disabled}
                  data-official-catalog-add={catalog.id}
                  aria-label={t("connectApps.market.official.addAria", { name: catalog.label })}
                  onClick={() => onAdd(catalog.source)}>
                  {adding === catalog.source ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {t("connectApps.market.official.add")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
