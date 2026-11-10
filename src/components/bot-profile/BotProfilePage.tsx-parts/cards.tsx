// The page's cards and rows (#2271, split from BotProfilePage for #1383):
// the grey-label card, its rows, a locked section's note, a tab's block,
// and the General tab's Channels and Bot accounts cards.
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { BellRing, Cpu, KeyRound, Lock, Mail, MessageCircle, Plug, Plus, ServerCog, Trash2 } from "lucide-react";

import { useStore, type Bot, type BotSettingsSection } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { useBotInboundMailState } from "@/lib/bot-inbound-mail";
import { useReachMe } from "@/lib/reach-me";
import { loadMessagesSetup } from "@/lib/mac-messages-setup";
import { capabilityName, orderedCapabilities, reasonText, stateWord, useBotCapabilities, type Capability } from "@/lib/capabilities";
import { mcpAccountFor, mcpServersForBot, useMcpServers, withMcpAccount, type McpServerSummary } from "@/lib/mcp-servers";
import { providerMark } from "@/lib/plugins-model";
import { setMine } from "@/lib/org-capabilities";
import { canEditBotField } from "@/lib/bot-capabilities";
import { readableError } from "@/lib/plain-error";
import { readableOr } from "../../../../shared/human-id";
import { readableName } from "../../../../shared/readable-name";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import type { BotProfileTab, PersonaCategory } from "@/lib/persona-sections";
import type { MessagesSetupStatus } from "../../../../shared/mac-messages-setup";
import { AnchoredPopover, useAnchoredDismissRoot } from "../../AnchoredPopover";
import { HelpTip, PILL, PillSelect, Switch } from "../../SettingsPrimitives";
import { PluginIcon } from "../../plugins/PluginParts";
import { ProposalStatus } from "../../bot-settings/ProposalStatus";
import { TeamVaultForm, teamVaultLine, useTeamBotVault } from "../../bot-settings/TeamBotVaultSection";
import { BOT_SECTIONS } from "../../bot-settings/sections";
import { SlackSection } from "../../bot-settings/SlackSection";
import { BotEmailAddress } from "../../bot-settings/BotEmailAddress";
import { BotReachMe } from "../../bot-settings/BotReachMe";

const ENTRY = new Map(BOT_SECTIONS.map((entry) => [entry.id, entry]));

/** A section's name, as the editor's rail named it. */
export function sectionLabel(id: BotSettingsSection): string {
  const entry = ENTRY.get(id);
  if (!entry) return id;
  return entry.labelKey ? t(entry.labelKey) : entry.label;
}

/** The tabs' names (V6, #2612; Appearance its own tab, JC 2026-11-08). */
export const TAB_LABEL: Record<BotProfileTab, LocaleKey> = {
  general: "botProfile.tab.general",
  appearance: "botProfile.tab.appearance",
  knowledge: "botProfile.tab.knowledge",
  stats: "botProfile.tab.stats",
};

const REACH_LABEL: Record<string, LocaleKey> = {
  push: "botPanel.reachMe.push.label",
  sms: "botPanel.reachMe.sms.label",
  teams: "botPanel.reachMe.teams.label",
  telegram: "botPanel.reachMe.telegram.label",
  whatsapp: "botPanel.reachMe.whatsapp.label",
};

export type Channel = "slack" | "email" | "reachMe" | "messages";

/** The row of a locked section's card: why this viewer may only read it. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <p role="note" data-persona-locked="" aria-label={t("persona.lockedBadge")} className="m-0 flex min-h-[44px] items-center gap-3 px-4 py-2 text-[14px] leading-5 text-ink-secondary">
      <Lock strokeWidth={1.5} aria-hidden="true" className="size-5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** One row of a card: icon, name, state under it, an action on the right,
 * and what the action unfolds under the row. */
export function CardRow({ icon, label, state, action, children, rowId }: {
  icon: ReactNode;
  label: string;
  state?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  rowId: string;
}) {
  return (
    <div data-bot-profile-row={rowId} className="flex flex-col">
      {/* every two-line row is 56 high, with or without an action (#3399) */}
      <div className={cn("flex items-center gap-3 px-4", action || (state !== undefined && state !== null) ? "min-h-[56px] py-2.5" : "min-h-[44px] py-2")}>
        <span className="flex size-5 shrink-0 items-center justify-center text-ink-secondary [&>svg]:size-5" aria-hidden="true">{icon}</span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[14px] leading-5 text-ink">{label}</span>
          {state !== undefined && state !== null && <span data-bot-profile-state="" className="truncate text-[12px] leading-4 text-ink-secondary">{state}</span>}
        </div>
        {action}
      </div>
      {children && <div className="px-4 pb-3 pt-1">{children}</div>}
    </div>
  );
}

/** A section of a tab's page: the same body as the bot panel's, whose
 * cards carry their own grey labels (the page adds no heading of its own).
 * A section this viewer may only read says so in its body (a Note). */
export function Block({ id, locked, children }: { id: PersonaCategory; locked: boolean; children: ReactNode }) {
  return (
    <section
      aria-label={sectionLabel(id)}
      data-bot-profile-section={id}
      data-persona-section={id}
      data-bot-profile-locked={locked ? "" : undefined}
      data-open=""
      className="flex min-w-0 flex-col gap-6"
    >
      {children}
    </section>
  );
}

/** A card of the page: a grey label (and its accessory) over a borderless
 * surface a step lighter than the page (Grok Bot). */
export function ProfileCard({ title, groupId, accessory, children }: {
  title: string;
  groupId: string;
  accessory?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-settings-group={groupId} className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-1.5 px-1">
        <h3 id={headingId} className="shrink-0 text-[13px] font-normal leading-[18px] text-ink-secondary">{title}</h3>
        {accessory}
      </div>
      <div className="flex flex-col rounded-2xl bg-card py-1">{children}</div>
    </section>
  );
}

/** Slack's own four-color mark (the lucide outline, filled). */
function SlackLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" data-slack-logo="">
      <rect x="2" y="8" width="8" height="3" rx="1.5" fill="#36C5F0" />
      <path d="M8.5 5H10V3.5A1.5 1.5 0 1 0 8.5 5" fill="#36C5F0" />
      <rect x="13" y="2" width="3" height="8" rx="1.5" fill="#2EB67D" />
      <path d="M19 8.5V10h1.5A1.5 1.5 0 1 0 19 8.5" fill="#2EB67D" />
      <rect x="14" y="13" width="8" height="3" rx="1.5" fill="#ECB22E" />
      <path d="M15.5 19H14v1.5a1.5 1.5 0 1 0 1.5-1.5" fill="#ECB22E" />
      <rect x="8" y="14" width="3" height="8" rx="1.5" fill="#E01E5A" />
      <path d="M5 15.5V14H3.5A1.5 1.5 0 1 0 5 15.5" fill="#E01E5A" />
    </svg>
  );
}

/** General > Channels, in place on the tab (#3398): where the bot can be
 * reached, each with its state and its Connect or Manage. A channel this
 * server does not offer is not drawn (Slack without its Admin link: Slack
 * as a channel is removed for now, shared/team-chat-channels.ts), and a
 * card with no channel left is not drawn. */
export function ChannelsCard({ bot, slackUrl, open, onOpen }: {
  bot: Bot;
  slackUrl: string | null | undefined;
  open: Channel | null;
  onOpen: (channel: Channel | null) => void;
}) {
  const { dispatch } = useStore();
  const [mail] = useBotInboundMailState(bot.id);
  const [reach] = useReachMe(bot.id);
  const [messages, setMessages] = useState<MessagesSetupStatus | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    loadMessagesSetup().then((status) => { if (!cancelled) setMessages(status); }, () => { if (!cancelled) setMessages(null); });
    return () => { cancelled = true; };
  }, []);

  const pill = (channel: Channel, connected: boolean) => (
    <button
      type="button"
      data-bot-profile-action={channel}
      aria-expanded={open === channel}
      onClick={() => onOpen(open === channel ? null : channel)}
      className={cn(PILL, "shrink-0")}
    >
      {open === channel ? t("botProfile.hide") : connected ? t("botProfile.manage") : t("botProfile.connect")}
    </button>
  );

  const reachOn = (reach?.settings.channels ?? []).map((id) => (REACH_LABEL[id] ? t(REACH_LABEL[id]!) : null)).filter((label): label is string => label !== null);
  const messagesHere = messages ? messages.available && messages.onThisMac : false;

  // An option the context makes impossible is not rendered (hiddenWhenUnavailable).
  const rows: ReactNode[] = [];
  if (slackUrl) {
    rows.push(
      <CardRow
        key="slack"
        rowId="slack"
        icon={<SlackLogo />}
        label={t("botProfile.channel.slack")}
        state={t("botProfile.state.managedInAdmin")}
        action={pill("slack", true)}
      >
        {open === "slack" ? <SlackSection managementUrl={slackUrl} /> : null}
      </CardRow>,
    );
  }
  if (mail === null || mail.available) {
    rows.push(
      <CardRow
        key="email"
        rowId="email"
        icon={<Mail />}
        label={t("botProfile.channel.email")}
        state={mail === null ? null : mail.address ?? t("botProfile.state.noAddress")}
        action={mail?.address ? pill("email", true) : undefined}
      >
        {open === "email" && mail?.address ? <BotEmailAddress botId={bot.id} /> : null}
      </CardRow>,
    );
  }
  rows.push(
    <CardRow
      key="reachMe"
      rowId="reachMe"
      icon={<BellRing />}
      label={t("botPanel.reachMe.label")}
      state={reach === null ? null : reachOn.length > 0 ? reachOn.join(", ") : t("botProfile.state.notConnected")}
      action={reach === null ? undefined : pill("reachMe", reachOn.length > 0)}
    >
      {open === "reachMe" ? <BotReachMe botId={bot.id} /> : null}
    </CardRow>,
  );
  if (messages === undefined || messagesHere) {
    rows.push(
        <CardRow
          key="messages"
          rowId="messages"
          icon={<MessageCircle />}
          label={t("botProfile.channel.messages")}
          state={messages === undefined ? null : messages!.useMessages ? t("botProfile.state.on") : t("botProfile.state.notConnected")}
          action={messagesHere ? (
            <button
              type="button"
              data-bot-profile-action="messages"
              onClick={() => {
                dispatch({ type: "togglePlugins", open: true, surface: "apps" });
                window.dispatchEvent(new CustomEvent("sagax:open-mac-messages"));
              }}
              className={cn(PILL, "shrink-0")}
            >
              {messages!.useMessages ? t("botProfile.manage") : t("botProfile.connect")}
            </button>
          ) : undefined}
        />,
    );
  }
  if (rows.length === 0) return null;

  return (
    <ProfileCard title={t("botProfile.channels")} groupId="bot-profile-channels">
      {rows}
    </ProfileCard>
  );
}

/** The name of the server a connector or server row stands for, when it is
 * one of this computer's (`mcp:installation:<name>`) or the person's own
 * (`mcp:me:<name>`): its switch is the bot's own list of servers. */
function serverNameOf(item: Capability): string | null {
  if (item.form !== "mcp") return null;
  const match = /^mcp:(?:installation|me):(.+)$/.exec(item.key);
  return match ? match[1]! : null;
}

/** A row's mark: the app's logo (the Plugins window's icon) when its name
 * is known, the plug otherwise. */
function AccountLogo({ name, form }: { name: string; form: "app" | "mcp" }) {
  const mark = providerMark(name);
  if (!mark.site && !mark.logo) return <Plug />;
  return <PluginIcon item={{ kind: form, name, logo: mark.logo ?? undefined, domain: mark.site ?? undefined }} className="size-5 rounded-md text-[11px]" />;
}

/** One item of the Add menu: a title and a grey line that says what it does. */
function AddItem({ icon, title, description, onChoose, id }: { icon: ReactNode; title: string; description: string; onChoose: () => void; id: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      data-bot-profile-add-item={id}
      onClick={onChoose}
      className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-hover focus-visible:bg-hover"
    >
      <span aria-hidden="true" className="mt-px flex size-4 shrink-0 items-center justify-center text-ink-secondary [&>svg]:size-4">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] leading-[18px] text-ink">{title}</span>
        <span data-bot-profile-add-description="" className="text-[12px] leading-4 text-ink-secondary">{description}</span>
      </span>
    </button>
  );
}

/** General > Bot accounts (#3399): what this bot has, one row each (its
 * engine, then each app or server that is on, off, set by the organization
 * or in need of attention, then the shared vault's logins), each with its
 * control at the right. An app or server still to connect is listed in the
 * Plugins window that Add opens for this bot. "+ Add" sits at the right of
 * the label, or in the empty row when the bot has nothing yet. */
export function AccountsCard({ bot, onEngine, derived, vault }: {
  bot: Bot;
  onEngine: () => void;
  derived: { patch: (patch: { mcpServers: string[] | null } | { mcpAccounts: Record<string, string> | null }) => void };
  /** this viewer manages the bot's shared vault (teamVaultOffered) */
  vault: boolean;
}) {
  const { state, dispatch, flushBotPatches } = useStore();
  const { data, error, loading, reload } = useBotCapabilities(bot.id);
  const { servers, error: serversError, refresh } = useMcpServers();
  const logins = useTeamBotVault(bot.id, vault);
  const [menuOpen, setMenuOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const focusOnOpen = useRef<"first" | "last">("first");
  const dismissRoot = useAnchoredDismissRoot(anchorRef, popoverRef);
  usePopoverDismiss(menuOpen, dismissRoot, () => setMenuOpen(false));

  const menuItems = () => Array.from(popoverRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  // the menu takes the focus when it opens (its first item, or the last on Up)
  useEffect(() => {
    if (!menuOpen) return;
    const list = menuItems();
    (focusOnOpen.current === "last" ? list[list.length - 1] : list[0])?.focus();
    focusOnOpen.current = "first";
  }, [menuOpen]);
  useEffect(() => { if (adding) firstFieldRef.current?.focus(); }, [adding]);

  const closeMenu = (refocus: boolean) => {
    setMenuOpen(false);
    if (refocus) anchorRef.current?.focus();
  };
  const connect = (surface: "apps" | "mcp") => {
    closeMenu(false);
    dispatch({ type: "togglePlugins", open: true, surface, botId: bot.id });
  };
  const onMenuKey = (event: ReactKeyboardEvent) => {
    if (!menuOpen) {
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && event.target === anchorRef.current) {
        event.preventDefault();
        focusOnOpen.current = event.key === "ArrowUp" ? "last" : "first";
        setMenuOpen(true);
      }
      return;
    }
    if (event.key === "Escape") {
      // the menu only: the page and the profile stay open
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab") {
      setMenuOpen(false);
      return;
    }
    const list = menuItems();
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? (at + 1) % list.length
      : event.key === "ArrowUp" ? (at <= 0 ? list.length - 1 : at - 1)
        : event.key === "Home" ? 0
          : event.key === "End" ? list.length - 1
            : null;
    if (next === null) return;
    event.preventDefault();
    list[next]!.focus();
  };

  // The bot's own list of servers is the switch of a server (Plugins keeps
  // adding, removing and setting them up): no list means every enabled one.
  // A viewer the server would refuse (a collaborator, a member without the
  // tools permission) sees each row's status with no control.
  const serversEditable = canEditBotField(state.config, bot, "mcpServers");
  const accountsEditable = canEditBotField(state.config, bot, "mcpAccounts");
  const mounted = new Set((servers ? mcpServersForBot(servers, bot.mcpServers) : []).map((server) => server.name));
  const usesAll = bot.mcpServers == null;
  const afterPatch = () => { void flushBotPatches(bot.id).then(() => reload(), (failure) => setActionError(readableError(failure))); };
  const toggleServer = (name: string) => {
    if (!servers || bot.busy || serversError) return;
    const current = usesAll ? servers.filter((server) => server.enabled).map((server) => server.name) : [...(bot.mcpServers ?? [])];
    derived.patch({ mcpServers: current.includes(name) ? current.filter((item) => item !== name) : [...current, name] });
    afterPatch();
  };
  const serverSwitch = (server: McpServerSummary) => (
    <Switch
      checked={mounted.has(server.name)}
      disabled={Boolean(bot.busy) || serversError}
      aria-label={t("botAccess.mcpAllow", { name: readableName(server.name) })}
      onClick={() => toggleServer(server.name)}
      className="disabled:cursor-not-allowed"
    />
  );
  const accountChoice = (server: McpServerSummary) => accountsEditable && server.accounts && mounted.has(server.name) ? (
    <span data-mcp-account={server.name} className="inline-flex min-w-0 max-w-[45%]">
      <PillSelect
        value={mcpAccountFor(server, bot.mcpAccounts)}
        disabled={serversError}
        onChange={(account) => { derived.patch({ mcpAccounts: withMcpAccount(bot.mcpAccounts, server.name, account) }); afterPatch(); }}
        ariaLabel={t("botAccess.mcpAccountAria", { name: readableName(server.name) })}
        options={server.accounts.map((account, index) => ({
          value: account.id,
          label: (account.id === "default" ? t("botAccess.mcpAccountFirst") : readableOr(account.label ?? account.id, t("ids.accountN", { n: index + 1 })))
            + (account.connected ? "" : ` (${t("mcp.accounts.notSignedIn")})`),
        }))}
      />
    </span>
  ) : null;
  const connectPill = (surface: "apps" | "mcp", name: string) => (
    <button type="button" data-bot-profile-connect="" aria-label={`${t("botProfile.connect")} ${name}`} onClick={() => connect(surface)} className={cn(PILL, "shrink-0")}>
      {t("botProfile.connect")}
    </button>
  );

  const byName = new Map((servers ?? []).map((server) => [server.name, server] as const));
  const capabilityRows = data ? orderedCapabilities(data.items).filter((item) => (item.form === "connector" || item.form === "mcp") && item.state !== "to_connect") : [];
  const named = new Set(data ? data.items.map(serverNameOf).filter((name): name is string => name !== null) : []);
  const rows: ReactNode[] = capabilityRows.map((item, index) => {
    const name = capabilityName(item);
    const serverName = serverNameOf(item);
    const server = serverName ? byName.get(serverName) : undefined;
    const switchable = server
      ? server.enabled && serversEditable && item.state !== "reserved"
      : item.canToggle && item.scope === "organization" && Boolean(item.orgDeclaration);
    // a switch flipped here says its new state before the list is read again
    const live = server && switchable && (item.state === "on" || item.state === "off") && mounted.has(server.name) !== item.enabled;
    const reason = item.supersededBy ? null : reasonText(item.reason);
    const state = live ? stateWord(mounted.has(server!.name) ? "on" : "off") : reason ? `${stateWord(item.state)} · ${reason}` : stateWord(item.state);
    const surface = item.form === "mcp" ? "mcp" : "apps";
    return (
      <CardRow
        key={item.key}
        rowId={`account-${index}`}
        icon={<AccountLogo name={name} form={item.form === "mcp" ? "mcp" : "app"} />}
        label={name}
        state={state}
        action={(
          <>
            {item.connect && connectPill(surface, name)}
            {server && accountChoice(server)}
            {switchable && (server ? serverSwitch(server) : (
              <Switch
                checked={item.enabled}
                aria-label={t(item.enabled ? "capabilities.row.offAria" : "capabilities.row.onAria", { name })}
                onClick={() => { void setMine(item.orgDeclaration!, !item.enabled).then(() => reload(), (failure) => setActionError(readableError(failure))); }}
              />
            ))}
          </>
        )}
      />
    );
  });
  // a server the list folds into its plugin keeps its switch for this bot
  for (const server of servers ?? []) {
    if (named.has(server.name) || !data) continue;
    const name = readableName(server.name);
    rows.push(
      <CardRow
        key={`server:${server.name}`}
        rowId={`server-${server.name}`}
        icon={<AccountLogo name={name} form="mcp" />}
        label={name}
        state={server.enabled ? stateWord(mounted.has(server.name) ? "on" : "off") : `${stateWord("off")} · ${t("botAccess.mcpDisabled")}`}
        action={server.enabled && serversEditable ? <>{accountChoice(server)}{serverSwitch(server)}</> : undefined}
      />,
    );
  }
  for (const login of vault ? logins.items ?? [] : []) {
    rows.push(
      <CardRow
        key={`vault:${login.id}`}
        rowId={`vault-${login.id}`}
        icon={<KeyRound />}
        label={login.name}
        state={`${t("botProfile.add.vault")} · ${teamVaultLine(login)}`}
        action={(
          <button type="button" data-bot-profile-vault-remove="" className={cn(PILL, "shrink-0")} disabled={logins.busy} onClick={() => void logins.remove(login.id)} aria-label={`${t("botPanel.teamVault.remove")} ${login.name}`} title={t("botPanel.teamVault.remove")}>
            <Trash2 size={13} aria-hidden="true" />
          </button>
        )}
      />,
    );
  }
  const empty = Boolean(data) && rows.length === 0 && !adding;

  const add = (
    <div className={empty ? "shrink-0" : "ml-auto"} onKeyDown={onMenuKey}>
      <button
        ref={anchorRef}
        type="button"
        data-bot-profile-add=""
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((value) => !value)}
        className={cn(PILL, "inline-flex shrink-0 items-center gap-1")}
      >
        <Plus size={13} aria-hidden="true" /> {t("botProfile.add")}
      </button>
      {menuOpen && (
        <AnchoredPopover
          anchorRef={anchorRef}
          popoverRef={popoverRef}
          align="end"
          role="menu"
          aria-label={t("botProfile.add")}
          className="w-[280px] rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1 text-ink shadow-xl"
        >
          <AddItem id="apps" icon={<Plug />} title={t("botProfile.add.apps")} description={t("botProfile.add.appsDescription")} onChoose={() => connect("apps")} />
          <AddItem id="mcp" icon={<ServerCog />} title={t("botProfile.add.mcp")} description={t("botProfile.add.mcpDescription")} onChoose={() => connect("mcp")} />
          {vault && (
            <AddItem id="vault" icon={<KeyRound />} title={t("botProfile.add.vault")} description={t("botProfile.add.vaultDescription")} onChoose={() => { closeMenu(false); setAdding(true); }} />
          )}
        </AnchoredPopover>
      )}
    </div>
  );

  const title = t("botProfile.accounts");
  return (
    <ProfileCard
      title={title}
      groupId="bot-profile-accounts"
      accessory={<>
        <ProposalStatus bot={bot} />
        <HelpTip label={t("settings.moreAbout", { title })}>{t("botAccess.mcpDescription")}</HelpTip>
        {!empty && add}
      </>}
    >
      {error && !data ? (
        <div role="alert" data-bot-profile-accounts-error="" className="flex flex-col items-start gap-1 px-4 py-3.5">
          <span className="text-[14px] font-normal leading-5 text-ink">{t("botProfile.accounts.error")}</span>
          <span className="text-[12px] leading-4 text-ink-secondary">{error}</span>
          <button type="button" onClick={() => void reload()} className={cn(PILL, "mt-1")}>{t("botProfile.retry")}</button>
        </div>
      ) : !data ? (
        <div role="status" className="px-4 py-3 text-[12px] leading-4 text-ink-secondary">{loading ? t("botProfile.accounts.loading") : null}</div>
      ) : (
        <>
          <CardRow
            rowId="engine"
            icon={<Cpu />}
            label={data.engine.label}
            state={t("botProfile.engine")}
            action={<button type="button" data-bot-profile-action="engine" onClick={onEngine} className={cn(PILL, "shrink-0")}>{t("botProfile.manage")}</button>}
          />
          {rows}
          {empty && (
            <div data-bot-profile-accounts-empty="">
              <CardRow rowId="accounts-empty" icon={<Plug />} label={t("botProfile.accounts.emptyTitle")} state={t("botProfile.accounts.emptyLine")} action={add} />
            </div>
          )}
          {adding && (
            <div data-bot-profile-row="vault-new" className="flex flex-col gap-2 px-4 pb-3 pt-2">
              <span className="text-[14px] leading-5 text-ink">{t("botProfile.add.vault")}</span>
              <span className="text-[12px] leading-4 text-ink-secondary">{t("botPanel.teamVault.help", { bot: bot.name })}</span>
              <TeamVaultForm
                plain
                busy={logins.busy}
                firstFieldRef={firstFieldRef}
                onSave={async (login) => {
                  const saved = await logins.add(login);
                  if (saved) setAdding(false);
                  return saved;
                }}
                onCancel={() => setAdding(false)}
                className="flex flex-col gap-2"
              />
            </div>
          )}
          {vault && logins.error && <p role="alert" className="px-4 pb-2 text-[12px] leading-4 text-danger">{logins.error}</p>}
          {(serversError || actionError) && (
            <div role="alert" className="flex flex-wrap items-center gap-2 px-4 pb-2 text-[12px] leading-4 text-danger">
              {actionError ?? t("botAccess.mcpRefreshError")}
              {serversError && !actionError && <button type="button" onClick={() => void refresh()} className={PILL}>{t("connectors.action.retry")}</button>}
            </div>
          )}
          {!usesAll && serversEditable && servers && servers.length > 0 && (
            <div className="flex justify-end px-4 pb-2 pt-1">
              <button type="button" disabled={Boolean(bot.busy) || serversError} onClick={() => { if (!bot.busy && !serversError) { derived.patch({ mcpServers: null }); afterPatch(); } }} className={PILL}>
                {t("botAccess.mcpUseAll")}
              </button>
            </div>
          )}
          {bot.busy && <p className="px-4 pb-2 text-[12px] leading-4 text-ink-secondary">{t("botAccess.mcpBusy")}</p>}
        </>
      )}
    </ProfileCard>
  );
}
